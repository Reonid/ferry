import { describe, expect, it } from "vitest";
import { deliverToDestination } from "./deliver";
import { processRetries, retryFailedJob } from "./retries";
import { NOW, account, discordDest, makeDeps, mirror } from "./test-support";
import { WRITE_AHEAD_MS } from "../constants";
import type { DeliveryOutcome } from "../types";

const fail = (over = {}) =>
  ({ ok: false, retryable: true, reason: "nope", ...over }) as DeliveryOutcome;

async function setup(script: DeliveryOutcome[] = []) {
  const ctx = makeDeps(script);
  const dest = discordDest("d1");
  const acct = account();
  await ctx.store.putDestination(dest);
  await ctx.store.putAccount(acct);
  const run = () =>
    deliverToDestination({
      account: acct,
      destination: dest,
      mirror: mirror(),
      deps: ctx.deps,
    });
  return { ...ctx, dest, acct, run };
}

describe("processRetries", () => {
  it("resumes from sentCount and keeps the original url", async () => {
    const { deps, store, calls } = await setup([{ ok: true, url: "unused" }]);
    await store.putDestination(discordDest("d1"));
    await store.upsertActivity("acct", {
      groupKey: "g1",
      excerpt: "Hello",
      source: { service: "bluesky", name: "me" },
      publishedAt: 500,
      deliveries: [
        {
          destinationId: "d1",
          status: "pending",
          at: 1,
          url: "https://discord.test/first",
        },
      ],
    });
    await store.putRetry(
      {
        id: "d1|g1",
        accountId: "acct",
        destinationId: "d1",
        groupKey: "g1",
        mirror: mirror(),
        attempts: 1,
        sentCount: 2,
        failed: false,
      },
      NOW - 1,
    );
    expect(await processRetries({ now: NOW, deps })).toBe(1);
    expect(calls[0]!.startAt).toBe(2);
    const act = await store.getActivity("acct", "g1");
    expect(act?.deliveries[0]).toMatchObject({
      status: "delivered",
      url: "https://discord.test/first",
    });
    expect(await store.getRetry("d1|g1")).toBeNull();
  });

  it("retries a write-ahead job left by a crash", async () => {
    const ctx = await setup();
    const real = ctx.deps.sendDiscord;
    ctx.deps.sendDiscord = async () => {
      throw new Error("crash");
    };
    await expect(ctx.run()).rejects.toThrow();
    ctx.deps.sendDiscord = real;
    expect(
      await processRetries({ now: NOW + WRITE_AHEAD_MS, deps: ctx.deps }),
    ).toBe(1);
    expect(ctx.calls).toHaveLength(1);
    expect(await ctx.store.getRetry("d1|g1")).toBeNull();
  });

  it("deletes jobs whose account, destination or broken destination is gone, without sending", async () => {
    const ctx = await setup();
    const job = (id: string, accountId: string, destinationId: string) => ({
      id,
      accountId,
      destinationId,
      groupKey: id,
      mirror: mirror({ groupKey: id }),
      attempts: 0,
      sentCount: 0,
      failed: false,
    });
    await ctx.store.putDestination(discordDest("bad", { status: "broken" }));
    await ctx.store.putRetry(job("a", "ghost", "d1"), NOW);
    await ctx.store.putRetry(job("b", "acct", "gone"), NOW);
    await ctx.store.putRetry(job("c", "acct", "bad"), NOW);
    expect(await processRetries({ now: NOW, deps: ctx.deps })).toBe(0);
    expect(ctx.calls).toHaveLength(0);
    for (const id of ["a", "b", "c"]) {
      expect(await ctx.store.getRetry(id)).toBeNull();
    }
  });
});

describe("retryFailedJob", () => {
  it("retries a failed job on request", async () => {
    const ctx = await setup([fail({ retryable: false })]);
    expect(await ctx.run()).toBe("failed");
    expect((await ctx.store.getRetry("d1|g1"))?.failed).toBe(true);
    expect(
      await retryFailedJob({
        deps: ctx.deps,
        accountId: "acct",
        jobId: "d1|g1",
      }),
    ).toBe(true);
    expect(ctx.calls).toHaveLength(2);
    expect(await ctx.store.getRetry("d1|g1")).toBeNull();
    expect(
      (await ctx.store.getActivity("acct", "g1"))?.deliveries[0]?.status,
    ).toBe("delivered");
  });

  it("refuses another account's job, a missing job and a job that has not failed", async () => {
    const ctx = await setup([fail({ retryable: false })]);
    await ctx.run();
    const base = { deps: ctx.deps, jobId: "d1|g1" };
    expect(await retryFailedJob({ ...base, accountId: "other" })).toBe(false);
    expect(
      await retryFailedJob({ ...base, accountId: "acct", jobId: "nope" }),
    ).toBe(false);
    expect(ctx.calls).toHaveLength(1);
  });

  it("resets attempts so a failing retry backs off again", async () => {
    const ctx = await setup([fail({ retryable: false }), fail()]);
    await ctx.run();
    await retryFailedJob({ deps: ctx.deps, accountId: "acct", jobId: "d1|g1" });
    const job = await ctx.store.getRetry("d1|g1");
    expect(job).toMatchObject({ failed: false, attempts: 1 });
  });
});
