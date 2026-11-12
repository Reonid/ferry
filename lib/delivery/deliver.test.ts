import { describe, expect, it } from "vitest";
import { deliverToDestination, runJob } from "./deliver";
import {
  NOW,
  account,
  discordDest,
  makeDeps,
  mirror,
  redditDest,
  route,
  telegramDest,
} from "./test-support";
import {
  CLAIM_GROUP_TTL_S,
  RETRY_DELAYS_MS,
  RETRY_JOB_TTL_S,
  WRITE_AHEAD_MS,
} from "../constants";
import type { DeliveryOutcome } from "../types";

const fail = (over: Partial<Extract<DeliveryOutcome, { ok: false }>> = {}) =>
  ({ ok: false, retryable: true, reason: "nope", ...over }) as DeliveryOutcome;

async function setup(script: DeliveryOutcome[] = [], notify = false) {
  const ctx = makeDeps(script);
  const dest = discordDest("d1");
  await ctx.store.putDestination(dest);
  if (notify) await ctx.store.putDestination(discordDest("n"));
  const acct = account({ notifyDestinationId: notify ? "n" : null });
  await ctx.store.putAccount(acct);
  const run = (m = mirror(), mode?: "test") =>
    deliverToDestination({
      account: acct,
      destination: dest,
      mirror: m,
      deps: ctx.deps,
      mode,
    });
  return { ...ctx, dest, acct, run };
}

describe("deliverToDestination", () => {
  it("delivers once and skips the same group next time", async () => {
    const { run, calls, store } = await setup();
    expect(await run()).toBe("delivered");
    expect(await run()).toBe("skipped");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.startAt).toBe(0);
    expect(await store.getRetry("d1|g1")).toBeNull();
    const act = await store.getActivity("acct", "g1");
    expect(act?.deliveries).toEqual([
      {
        destinationId: "d1",
        status: "delivered",
        at: NOW,
        url: "https://discord.test/m1",
      },
    ]);
  });

  it("skips a later copy whose fingerprint was already delivered", async () => {
    const { run, calls } = await setup();
    expect(await run(mirror({ groupKey: "fp:x", postIds: ["A"] }))).toBe(
      "delivered",
    );
    expect(await run(mirror({ groupKey: "fp:x", postIds: ["B"] }))).toBe(
      "skipped",
    );
    expect(calls).toHaveLength(1);
  });

  it("skips a copy with the same text from another content item, for a day", async () => {
    const { run, calls, store } = await setup();
    const ttls = new Map<string, number>();
    const orig = store.claim.bind(store);
    store.claim = async (k, ttl) => {
      ttls.set(k, ttl);
      return orig(k, ttl);
    };
    // Buffer's API makes each channel's post on its own, so the X and the
    // Bluesky copy of one announcement can carry different content items.
    expect(await run(mirror({ groupKey: "ci:x", postIds: ["X1"] }))).toBe(
      "delivered",
    );
    expect(await run(mirror({ groupKey: "ci:bsky", postIds: ["B1"] }))).toBe(
      "skipped",
    );
    // Other words, or the same words with another first image, cross.
    expect(
      await run(
        mirror({ groupKey: "ci:o", postIds: ["O1"], text: "Something else" }),
      ),
    ).toBe("delivered");
    expect(
      await run(
        mirror({
          groupKey: "ci:p",
          postIds: ["P1"],
          images: [
            { url: "https://img.test/2.png", alt: "", mimeType: "image/png" },
          ],
        }),
      ),
    ).toBe("delivered");
    expect(calls).toHaveLength(3);
    const textClaims = [...ttls].filter(([k]) => k.startsWith("d1:text:"));
    expect(textClaims.length).toBeGreaterThan(0);
    for (const [, ttl] of textClaims) expect(ttl).toBe(CLAIM_GROUP_TTL_S);
  });

  it("skips when a post was already claimed by another group", async () => {
    const { run, calls } = await setup();
    await run(mirror({ groupKey: "g1", postIds: ["A"] }));
    expect(await run(mirror({ groupKey: "g2", postIds: ["A"] }))).toBe(
      "skipped",
    );
    expect(calls).toHaveLength(1);
  });

  it("claims the group key, then the text, before the post keys", async () => {
    const { run, store } = await setup();
    const order: string[] = [];
    const orig = store.claim.bind(store);
    store.claim = async (k, ttl) => {
      order.push(k);
      return orig(k, ttl);
    };
    await run(mirror({ groupKey: "g9", postIds: ["a", "b"] }));
    expect(order).toEqual([
      "d1:group:g9",
      expect.stringMatching(/^d1:text:[0-9a-f]{64}$/),
      "d1:post:a",
      "d1:post:b",
    ]);
  });

  it("schedules retries 1, 5 and 30 minutes then 3 hours, then fails", async () => {
    const { run, store, deps } = await setup(Array(5).fill(fail()));
    expect(await run()).toBe("pending");
    const due = async () =>
      store.dueRetries(NOW + 365 * 24 * 3600_000, 10).then((j) => j[0]);
    expect((await due())?.attempts).toBe(1);
    // Re-dispatch the stored job through the same failure path each time.
    const { processRetries } = await import("./retries");
    for (const delay of RETRY_DELAYS_MS) {
      expect(await store.dueRetries(NOW + delay - 1, 10)).toHaveLength(0);
      expect(await store.dueRetries(NOW + delay, 10)).toHaveLength(1);
      await processRetries({ now: NOW + delay, deps });
    }
    const job = await store.getRetry("d1|g1");
    expect(job?.failed).toBe(true);
    expect(job?.attempts).toBe(5);
    expect(
      await store.dueRetries(NOW + RETRY_JOB_TTL_S * 1000 - 1, 10),
    ).toHaveLength(0);
    const act = await store.getActivity("acct", "g1");
    expect(act?.deliveries[0]).toMatchObject({
      status: "failed",
      reason: "nope",
      jobId: "d1|g1",
    });
  });

  it("honors retryAfterMs from a 429", async () => {
    const { run, store } = await setup([fail({ retryAfterMs: 7_000 })]);
    expect(await run()).toBe("pending");
    expect(await store.dueRetries(NOW + 6_999, 10)).toHaveLength(0);
    expect(await store.dueRetries(NOW + 7_000, 10)).toHaveLength(1);
  });

  it("remembers how many messages were sent", async () => {
    const { run, store } = await setup([fail({ sentCount: 2 })]);
    await run();
    expect((await store.getRetry("d1|g1"))?.sentCount).toBe(2);
  });

  it("fails without retrying a non-retryable error", async () => {
    const { run, store } = await setup([fail({ retryable: false })]);
    expect(await run()).toBe("failed");
    expect((await store.getRetry("d1|g1"))?.failed).toBe(true);
  });

  it("marks the destination broken, pauses its routes and alerts once", async () => {
    const { run, store, calls, acct, dest, deps } = await setup(
      [
        fail({ retryable: false, destinationBroken: true }),
        fail({ retryable: false, destinationBroken: true }),
      ],
      true,
    );
    await store.putRoute(route("r1", "d1"));
    await store.putRoute(route("r2", "other"));
    expect(await run()).toBe("failed");
    expect((await store.getDestination("d1"))?.status).toBe("broken");
    expect((await store.getRoute("r1"))?.paused).toBe(true);
    expect((await store.getRoute("r2"))?.paused).toBe(false);
    expect(await store.getRetry("d1|g1")).toBeNull();
    const alerts = await store.listAlerts("acct", 10);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.key).toBe("dest-broken:d1");
    expect(alerts[0]!.message).toBe(
      "Ferry can't post to Chan d1 anymore. Reconnect it.",
    );
    // d1 send + one alert to n
    expect(calls.map((c) => c.webhookId)).toEqual(["wh-d1", "wh-n"]);

    await deliverToDestination({
      account: acct,
      destination: dest,
      mirror: mirror({ groupKey: "g2", postIds: ["p2"] }),
      deps,
    });
    expect(await store.listAlerts("acct", 10)).toHaveLength(1);
    expect(calls.filter((c) => c.webhookId === "wh-n")).toHaveLength(1);
  });

  it("leaves a write-ahead job when sending throws", async () => {
    const ctx = await setup();
    ctx.deps.sendDiscord = async () => {
      throw new Error("crash");
    };
    await expect(ctx.run()).rejects.toThrow("crash");
    const job = await ctx.store.getRetry("d1|g1");
    expect(job).toMatchObject({ attempts: 0, failed: false });
    expect(await ctx.store.dueRetries(NOW + WRITE_AHEAD_MS - 1, 10)).toEqual(
      [],
    );
    expect(await ctx.store.dueRetries(NOW + WRITE_AHEAD_MS, 10)).toHaveLength(
      1,
    );
    expect(
      (await ctx.store.getActivity("acct", "g1"))?.deliveries[0]?.status,
    ).toBe("pending");
  });

  it("releases claims when the write-ahead fails", async () => {
    const ctx = await setup();
    ctx.store.putRetry = async () => {
      throw new Error("redis down");
    };
    await expect(
      ctx.run(mirror({ groupKey: "g7", postIds: ["a", "b"] })),
    ).rejects.toThrow("redis down");
    for (const k of ["d1:group:g7", "d1:post:a", "d1:post:b"]) {
      expect(await ctx.store.claim(k, 10)).toBe(true);
    }
  });

  it("creates a Reddit draft and notifies the private channel", async () => {
    const ctx = await setup([], true);
    const dest = redditDest("r1");
    const status = await deliverToDestination({
      account: ctx.acct,
      destination: dest,
      mirror: mirror({ text: "A short title. And a body." }),
      deps: ctx.deps,
    });
    expect(status).toBe("draft_ready");
    const draft = await ctx.store.getDraft("tok1");
    expect(draft).toMatchObject({ subreddit: "test", accountId: "acct" });
    expect(ctx.calls).toHaveLength(1);
    expect(ctx.calls[0]!.webhookId).toBe("wh-n");
    expect(JSON.stringify(ctx.calls[0]!.messages[0]!.components)).toContain(
      "https://ferry.test/d/tok1/post",
    );
    expect(await ctx.store.getRetry("r1|g1")).toBeNull();
    expect(
      (await ctx.store.getActivity("acct", "g1"))?.deliveries[0],
    ).toMatchObject({ destinationId: "r1", status: "draft_ready" });
  });

  it("keeps the draft when the notice fails", async () => {
    const ctx = await setup([fail({ retryable: false })], true);
    const status = await deliverToDestination({
      account: ctx.acct,
      destination: redditDest("r1"),
      mirror: mirror(),
      deps: ctx.deps,
    });
    expect(status).toBe("draft_ready");
    expect(await ctx.store.getDraft("tok1")).not.toBeNull();
  });

  it("sends every time in test mode", async () => {
    const { run, calls, store } = await setup();
    expect(await run(mirror(), "test")).toBe("delivered");
    expect(await run(mirror(), "test")).toBe("delivered");
    expect(calls).toHaveLength(2);
    expect(await store.claim("d1:group:g1", 10)).toBe(true);
  });

  it("merges deliveries per destination into one activity entry", async () => {
    const ctx = await setup();
    const second = discordDest("d2");
    await ctx.run();
    await deliverToDestination({
      account: ctx.acct,
      destination: second,
      mirror: mirror(),
      deps: ctx.deps,
    });
    const act = await ctx.store.getActivity("acct", "g1");
    expect(act?.deliveries.map((d) => d.destinationId).sort()).toEqual([
      "d1",
      "d2",
    ]);
    expect(act?.deliveries.every((d) => d.status === "delivered")).toBe(true);
  });

  it("cuts the excerpt on code points, never splitting a surrogate pair", async () => {
    const { run, store } = await setup();
    await run(mirror({ text: "😀".repeat(100) }));
    const act = await store.getActivity("acct", "g1");
    expect(Array.from(act!.excerpt)).toHaveLength(80);
    expect(act!.excerpt).toBe("😀".repeat(80));
  });

  describe("Telegram", () => {
    const tgRun = async (tgScript: DeliveryOutcome[] = []) => {
      const ctx = makeDeps([], tgScript);
      const dest = telegramDest("t1");
      await ctx.store.putDestination(dest);
      await ctx.store.putDestination(
        telegramDest("n", { chatType: "private" }),
      );
      const acct = account({ notifyDestinationId: "n" });
      await ctx.store.putAccount(acct);
      const run = (m = mirror()) =>
        deliverToDestination({
          account: acct,
          destination: dest,
          mirror: m,
          deps: ctx.deps,
        });
      return { ...ctx, dest, acct, run };
    };

    it("delivers to a Telegram channel once and skips the same group next time", async () => {
      const { run, telegramCalls, store, dest } = await tgRun();
      expect(await run()).toBe("delivered");
      expect(await run()).toBe("skipped");
      expect(telegramCalls).toHaveLength(1);
      expect(telegramCalls[0]).toMatchObject({
        token: "test-token",
        chatId: dest.chatId,
        startAt: 0,
      });
      expect(telegramCalls[0]!.calls[0]!.method).toBe("sendMessage");
      expect(await store.getRetry("t1|g1")).toBeNull();
      expect(
        (await store.getActivity("acct", "g1"))?.deliveries[0],
      ).toMatchObject({ destinationId: "t1", status: "delivered" });
    });

    it("resumes a Telegram send from sentCount", async () => {
      const { run, telegramCalls, store, deps, acct, dest } = await tgRun([
        fail({ sentCount: 1 }),
      ]);
      expect(await run()).toBe("pending");
      const job = (await store.getRetry("t1|g1"))!;
      expect(job.sentCount).toBe(1);
      expect(
        await runJob({ deps, account: acct, destination: dest, job }),
      ).toBe("delivered");
      expect(telegramCalls.map((c) => c.startAt)).toEqual([0, 1]);
    });

    it("marks a Telegram destination broken on 403 and alerts once", async () => {
      const { run, store, telegramCalls, acct, dest, deps } = await tgRun([
        fail({ retryable: false, destinationBroken: true }),
      ]);
      await store.putRoute(route("r1", "t1"));
      expect(await run()).toBe("failed");
      expect((await store.getDestination("t1"))?.status).toBe("broken");
      expect((await store.getRoute("r1"))?.paused).toBe(true);
      expect(await store.getRetry("t1|g1")).toBeNull();
      const alerts = await store.listAlerts("acct", 10);
      expect(alerts).toHaveLength(1);
      expect(alerts[0]!.message).toBe(
        "Ferry can't post to Tg t1 anymore. Reconnect it.",
      );
      expect(telegramCalls.map((c) => c.chatId)).toEqual(["-100t1", "-100n"]);
      await deliverToDestination({
        account: acct,
        destination: dest,
        mirror: mirror({ groupKey: "g2", postIds: ["p2"] }),
        deps,
      });
      expect(await store.listAlerts("acct", 10)).toHaveLength(1);
      expect(telegramCalls.filter((c) => c.chatId === "-100n")).toHaveLength(1);
    });

    it("sends Reddit draft notices to a Telegram DM", async () => {
      const { store, telegramCalls, deps, acct } = await tgRun();
      const status = await deliverToDestination({
        account: acct,
        destination: redditDest("r1"),
        mirror: mirror({ text: "A short title. And a body." }),
        deps,
      });
      expect(status).toBe("draft_ready");
      expect(await store.getDraft("tok1")).not.toBeNull();
      expect(telegramCalls).toHaveLength(1);
      expect(telegramCalls[0]!.chatId).toBe("-100n");
      expect(JSON.stringify(telegramCalls[0]!.calls[0])).toContain(
        "https://ferry.test/d/tok1/post",
      );
    });

    it("retries a rejected notice once without buttons", async () => {
      const { telegramCalls, deps, acct } = await tgRun([
        fail({ retryable: false }),
      ]);
      await deliverToDestination({
        account: acct,
        destination: redditDest("r1"),
        mirror: mirror(),
        deps,
      });
      expect(telegramCalls).toHaveLength(2);
      const retry = telegramCalls[1]!.calls[0]!;
      expect(retry.params.reply_markup).toBeUndefined();
      expect(retry.params.text).toContain(
        "Open draft: https://ferry.test/d/tok1",
      );
    });

    it("fails clearly when Telegram isn't configured", async () => {
      const { run, telegramCalls, deps, store } = await tgRun();
      deps.telegram = null;
      expect(await run()).toBe("failed");
      expect(telegramCalls).toHaveLength(0);
      expect(
        (await store.getActivity("acct", "g1"))?.deliveries[0]?.reason,
      ).toBe("Telegram isn't set up on this Ferry.");
    });
  });
});
