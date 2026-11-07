import { describe, expect, it, vi } from "vitest";
import { ACCOUNT_QUERY } from "../buffer/queries";
import { SEND_LATEST_COOLDOWN_MS } from "../constants";
import { account, discordDest, redditDest } from "../delivery/test-support";
import { runSync } from "../sync/runner";
import {
  BufferError,
  channel,
  makeSyncDeps,
  NOW,
  rawPost,
} from "../sync/test-support";
import {
  addDiscordDestination,
  addRedditDestination,
  createRoute,
  deleteRoute,
  refreshChannels,
  removeDestination,
  renameDestination,
  retryJob,
  sendLatestPost,
  setNotifyDestination,
  setRoutePaused,
  validateRouteInput,
} from "./manage";

const channels = [channel({ id: "ch" }), channel({ id: "ch2" })];
const destinations = [
  discordDest("d1"),
  { ...discordDest("d2"), status: "broken" as const },
];
const valid = {
  channelIds: ["ch"],
  destinationId: "d1",
  tagNames: [],
  channels,
  destinations,
};

describe("validateRouteInput", () => {
  it("requires a channel", () => {
    expect(validateRouteInput({ ...valid, channelIds: [] })).toEqual({
      ok: false,
      error: "Pick at least one channel.",
    });
  });
  it("rejects channels outside the account", () => {
    expect(validateRouteInput({ ...valid, channelIds: ["nope"] })).toEqual({
      ok: false,
      error: "Pick channels from your Buffer account.",
    });
  });
  it("rejects unknown destinations", () => {
    expect(validateRouteInput({ ...valid, destinationId: "zzz" })).toEqual({
      ok: false,
      error: "Pick one of your destinations.",
    });
  });
  it("rejects broken destinations", () => {
    expect(validateRouteInput({ ...valid, destinationId: "d2" })).toEqual({
      ok: false,
      error: "Reconnect this destination first.",
    });
  });
  it("normalizes tag names", () => {
    const tags = [
      " Launch ",
      "launch",
      "LAUNCH",
      "",
      "News",
      ...Array(20).keys(),
    ].map(String);
    const r = validateRouteInput({ ...valid, tagNames: tags });
    expect(r.ok && r.tagNames.slice(0, 2)).toEqual(["launch", "news"]);
    expect(r.ok && r.tagNames.length).toBe(10);
  });
});

describe("routes", () => {
  it("starts new routes now and schedules a sync", async () => {
    const { store } = makeSyncDeps();
    await store.putAccount(account());
    await store.putChannels("acct", channels);
    await store.putDestination(discordDest("d1"));
    const r = await createRoute(
      store,
      "acct",
      { channelIds: ["ch"], destinationId: "d1", tagNames: ["A"] },
      NOW,
    );
    expect(r.ok).toBe(true);
    const [route] = await store.listRoutes("acct");
    expect(route).toMatchObject({
      activeSince: NOW,
      tagNames: ["a"],
      paused: false,
      accountId: "acct",
    });
    expect(await store.dueAccounts(NOW, 10)).toContain("acct");
  });

  it("only touches the caller's own routes", async () => {
    const { store } = makeSyncDeps();
    await store.putAccount(account());
    await store.putRoute({
      id: "r1",
      accountId: "other",
      channelIds: ["ch"],
      tagNames: [],
      destinationId: "d1",
      activeSince: 0,
      paused: false,
      createdAt: 1,
    });
    expect((await setRoutePaused(store, "acct", "r1", true, NOW)).ok).toBe(
      false,
    );
    expect((await deleteRoute(store, "acct", "r1")).ok).toBe(false);
    expect((await store.getRoute("r1"))?.paused).toBe(false);
  });

  it("pauses and deletes own routes", async () => {
    const { store } = makeSyncDeps();
    await store.putAccount(account());
    await store.putChannels("acct", channels);
    await store.putDestination(discordDest("d1"));
    await createRoute(
      store,
      "acct",
      { channelIds: ["ch"], destinationId: "d1", tagNames: [] },
      NOW,
    );
    const [route] = await store.listRoutes("acct");
    await setRoutePaused(store, "acct", route!.id, true, NOW);
    expect((await store.getRoute(route!.id))?.paused).toBe(true);
    await deleteRoute(store, "acct", route!.id);
    expect(await store.listRoutes("acct")).toEqual([]);
  });

  it("a post published while the route was paused doesn't cross after resume", async () => {
    // rawPost() went out a minute before NOW, while the route was paused.
    const { deps, store, calls } = makeSyncDeps({ posts: [rawPost()] });
    await store.putAccount(account());
    await store.putChannels("acct", channels);
    await store.putDestination(discordDest("d1"));
    const created = NOW - 10 * 60_000;
    await createRoute(
      store,
      "acct",
      { channelIds: ["ch"], destinationId: "d1", tagNames: [] },
      created,
    );
    const [route] = await store.listRoutes("acct");
    const id = route!.id;
    await setRoutePaused(store, "acct", id, true, NOW - 5 * 60_000);
    expect((await store.getRoute(id))?.activeSince).toBe(created);
    expect((await runSync("acct", deps)).status).toBe("no_routes");
    expect(await store.countScheduled()).toBe(0);

    const resumed = NOW - 30_000;
    await setRoutePaused(store, "acct", id, false, resumed);
    expect(await store.getRoute(id)).toMatchObject({
      paused: false,
      activeSince: resumed,
    });
    expect(await store.dueAccounts(resumed, 10)).toEqual(["acct"]);
    expect((await store.getSyncState("acct")).nextRunAt).toBe(resumed);

    const report = await runSync("acct", deps);
    expect(report.status).toBe("ok");
    expect(report.delivered).toBe(0);
    expect(calls).toHaveLength(0);

    // Resuming a route that is already running leaves its start alone.
    await setRoutePaused(store, "acct", id, false, NOW);
    expect((await store.getRoute(id))?.activeSince).toBe(resumed);
  });
});

describe("destinations", () => {
  it("adds a Reddit destination from messy input", async () => {
    const { store } = makeSyncDeps();
    const r = await addRedditDestination(
      store,
      "acct",
      "https://reddit.com/r/SideProject/",
      NOW,
    );
    expect(r.ok).toBe(true);
    const [d] = await store.listDestinations("acct");
    expect(d).toMatchObject({
      kind: "reddit",
      subreddit: "SideProject",
      label: "r/SideProject",
    });
    expect(await addRedditDestination(store, "acct", "!!", NOW)).toEqual({
      ok: false,
      error: "Enter a subreddit like r/SideProject.",
    });
  });

  it("adds a Discord destination", async () => {
    const { store } = makeSyncDeps();
    const d = await addDiscordDestination(
      store,
      "acct",
      { webhookId: "w", webhookToken: "t", guildId: "g", channelId: "c" },
      NOW,
    );
    expect(d).toMatchObject({ kind: "discord", label: "Discord channel" });
    expect(await store.getDestination(d.id)).toMatchObject({
      webhookToken: "t",
      status: "active",
    });
  });

  it("renames within 60 characters, only for the owner", async () => {
    const { store } = makeSyncDeps();
    await store.putDestination(discordDest("d1"));
    await store.putDestination({ ...discordDest("d9"), accountId: "other" });
    expect((await renameDestination(store, "acct", "d1", " New ")).ok).toBe(
      true,
    );
    expect((await store.getDestination("d1"))?.label).toBe("New");
    expect(
      (await renameDestination(store, "acct", "d1", "x".repeat(61))).ok,
    ).toBe(false);
    expect((await renameDestination(store, "acct", "d9", "Mine")).ok).toBe(
      false,
    );
    expect((await store.getDestination("d9"))?.label).toBe("Chan d9");
  });

  it("removing a destination removes its routes and the alert target", async () => {
    const { store } = makeSyncDeps();
    await store.putAccount(account({ notifyDestinationId: "d1" }));
    await store.putChannels("acct", channels);
    await store.putDestination(discordDest("d1"));
    await store.putDestination(discordDest("d2"));
    for (const dest of ["d1", "d2"])
      await createRoute(
        store,
        "acct",
        { channelIds: ["ch"], destinationId: dest, tagNames: [] },
        NOW,
      );
    expect((await removeDestination(store, "acct", "d1")).ok).toBe(true);
    expect(await store.getDestination("d1")).toBeNull();
    const routes = await store.listRoutes("acct");
    expect(routes.map((r) => r.destinationId)).toEqual(["d2"]);
    expect((await store.getAccount("acct"))?.notifyDestinationId).toBeNull();
  });

  it("refuses to remove another account's destination", async () => {
    const { store } = makeSyncDeps();
    await store.putDestination({ ...discordDest("d9"), accountId: "other" });
    expect((await removeDestination(store, "acct", "d9")).ok).toBe(false);
    expect(await store.getDestination("d9")).not.toBeNull();
  });

  it("refuses a Reddit destination as the alert target", async () => {
    const { store } = makeSyncDeps();
    await store.putAccount(account());
    await store.putDestination(redditDest("rd"));
    await store.putDestination(discordDest("d1"));
    expect(await setNotifyDestination(store, "acct", "rd")).toEqual({
      ok: false,
      error: "Pick a Discord channel for alerts.",
    });
    expect((await setNotifyDestination(store, "acct", "d1")).ok).toBe(true);
    expect((await store.getAccount("acct"))?.notifyDestinationId).toBe("d1");
    await setNotifyDestination(store, "acct", null);
    expect((await store.getAccount("acct"))?.notifyDestinationId).toBeNull();
  });

  it("refuses another account's Discord channel as the alert target", async () => {
    const { store } = makeSyncDeps();
    await store.putAccount(account());
    await store.putDestination({ ...discordDest("d9"), accountId: "other" });
    expect((await setNotifyDestination(store, "acct", "d9")).ok).toBe(false);
  });
});

async function seedSend() {
  const ctx = makeSyncDeps();
  await ctx.store.putAccount(account());
  await ctx.store.putChannels("acct", [channel()]);
  await ctx.store.putDestination(discordDest("d1"));
  await createRoute(
    ctx.store,
    "acct",
    { channelIds: ["ch"], destinationId: "d1", tagNames: [] },
    NOW,
  );
  const [route] = await ctx.store.listRoutes("acct");
  return { ...ctx, routeId: route!.id };
}

describe("sendLatestPost", () => {
  it("sends the latest post in test mode and counts the call", async () => {
    const { deps, store, routeId, buffer, calls } = await seedSend();
    buffer.mockResolvedValue({
      data: { posts: { edges: [{ node: rawPost() }] } },
      rateLimit: null,
    });
    const r = await sendLatestPost(deps, "acct", routeId);
    expect(r).toEqual({ ok: true, message: "Sent your latest post." });
    expect(buffer.mock.calls[0]![0].variables).toEqual({
      org: "org",
      ch: ["ch"],
    });
    expect(calls).toHaveLength(1);
    expect(await store.getApiCalls("acct", "1970-01-01")).toBe(1);
    expect((await store.getSyncState("acct")).lastSendLatestAt).toBe(NOW);
  });

  it("rate-limits test sends", async () => {
    const { deps, store, routeId, buffer } = await seedSend();
    await store.putSyncState("acct", {
      ...(await store.getSyncState("acct")),
      lastSendLatestAt: NOW - SEND_LATEST_COOLDOWN_MS + 1000,
    });
    const r = await sendLatestPost(deps, "acct", routeId);
    expect(r).toEqual({
      ok: false,
      error: "Wait a few seconds before sending another test.",
    });
    expect(buffer).not.toHaveBeenCalled();
  });

  it("reports when there is nothing to send", async () => {
    const { deps, routeId, buffer } = await seedSend();
    buffer.mockResolvedValue({
      data: { posts: { edges: [] } },
      rateLimit: null,
    });
    const r = await sendLatestPost(deps, "acct", routeId);
    expect(r).toEqual({
      ok: false,
      error: "No sent posts on these channels yet.",
    });
  });

  it("asks for a channel refresh, without calling Buffer, when it knows none of the route's channels", async () => {
    const { deps, store, routeId, buffer } = await seedSend();
    await store.putChannels("acct", []);
    const r = await sendLatestPost(deps, "acct", routeId);
    expect(r).toEqual({
      ok: false,
      error: "Refresh your channels and try again.",
    });
    expect(buffer).not.toHaveBeenCalled();
  });

  it("asks to reconnect a broken destination without calling Buffer", async () => {
    const { deps, store, routeId, buffer } = await seedSend();
    await store.putDestination({ ...discordDest("d1"), status: "broken" });
    const r = await sendLatestPost(deps, "acct", routeId);
    expect(r).toEqual({
      ok: false,
      error: "Reconnect this destination first.",
    });
    expect(buffer).not.toHaveBeenCalled();
  });

  it("reports a failed delivery", async () => {
    const { deps, routeId, buffer } = await seedSend();
    buffer.mockResolvedValue({
      data: { posts: { edges: [{ node: rawPost() }] } },
      rateLimit: null,
    });
    vi.mocked(deps.sendDiscord).mockResolvedValue({
      ok: false,
      retryable: false,
      reason: "nope",
    });
    const r = await sendLatestPost(deps, "acct", routeId);
    expect(r).toEqual({
      ok: false,
      error: "That didn't go through. Check the activity below.",
    });
  });

  it("does not let another account use a route", async () => {
    const { deps, routeId, buffer } = await seedSend();
    const r = await sendLatestPost(deps, "someone-else", routeId);
    expect(r.ok).toBe(false);
    expect(buffer).not.toHaveBeenCalled();
  });
});

describe("refreshChannels", () => {
  it("re-reads the organizations, replaces their channels and keeps the rest", async () => {
    const { deps, store, buffer } = makeSyncDeps();
    // Signed in before joining org2.
    await store.putAccount(account({ organizationIds: ["org"] }));
    await store.putChannels("acct", [
      channel({ id: "old", organizationId: "org" }),
      channel({ id: "keep", organizationId: "gone" }),
    ]);
    buffer.mockImplementation(async ({ query, variables }) => ({
      data:
        query === ACCOUNT_QUERY
          ? {
              account: {
                id: "acct",
                organizations: [{ id: "org" }, { id: "org2" }],
              },
            }
          : {
              channels: [
                {
                  id: `new-${String(variables.org)}`,
                  organizationId: variables.org,
                  service: "bluesky",
                  name: "me",
                },
              ],
            },
      rateLimit: null,
    }));
    const r = await refreshChannels(deps, "acct");
    expect(r.ok).toBe(true);
    expect(
      buffer.mock.calls.map(([call]) => [
        call.query === ACCOUNT_QUERY ? "account" : "channels",
        call.variables,
      ]),
    ).toEqual([
      ["account", {}],
      ["channels", { org: "org" }],
      ["channels", { org: "org2" }],
    ]);
    expect((await store.getAccount("acct"))?.organizationIds).toEqual([
      "org",
      "org2",
    ]);
    const ids = (await store.getChannels("acct")).map((c) => c.id).sort();
    expect(ids).toEqual(["keep", "new-org", "new-org2"]);
    expect(await store.getApiCalls("acct", "1970-01-01")).toBe(3);
  });
});

describe("actions that call Buffer", () => {
  const REAUTH = "Buffer disconnected Ferry. Sign in again.";
  const WAITING =
    "Ferry is waiting on Buffer's rate limit. Try again in a few minutes.";
  const actions = {
    sendLatestPost: async () => {
      const ctx = await seedSend();
      ctx.buffer.mockResolvedValue({
        data: { posts: { edges: [{ node: rawPost() }] } },
        rateLimit: null,
      });
      return {
        ...ctx,
        run: () => sendLatestPost(ctx.deps, "acct", ctx.routeId),
      };
    },
    refreshChannels: async () => {
      const ctx = makeSyncDeps();
      await ctx.store.putAccount(account());
      ctx.buffer.mockImplementation(async ({ query }) => ({
        data:
          query === ACCOUNT_QUERY
            ? { account: { id: "acct", organizations: [{ id: "org" }] } }
            : { channels: [] },
        rateLimit: null,
      }));
      return { ...ctx, run: () => refreshChannels(ctx.deps, "acct") };
    },
  };

  for (const [name, setup] of Object.entries(actions)) {
    describe(name, () => {
      it("marks the account for sign-in when Buffer rejects Ferry", async () => {
        const { store, buffer, run } = await setup();
        buffer.mockRejectedValue(
          new BufferError("nope", { kind: "auth", status: 401 }),
        );
        expect(await run()).toEqual({ ok: false, error: REAUTH });
        expect((await store.getAccount("acct"))?.status).toBe("needs_reauth");
      });

      it("asks to sign in again without calling Buffer", async () => {
        const { store, buffer, run } = await setup();
        await store.putAccount(account({ status: "needs_reauth" }));
        expect(await run()).toEqual({ ok: false, error: REAUTH });
        expect(buffer).not.toHaveBeenCalled();
      });

      it("waits out Buffer's rate limit without calling Buffer", async () => {
        const { store, buffer, run } = await setup();
        await store.putSyncState("acct", {
          ...(await store.getSyncState("acct")),
          retryAt: NOW + 1,
        });
        expect(await run()).toEqual({ ok: false, error: WAITING });
        expect(buffer).not.toHaveBeenCalled();
      });

      it("goes ahead once retryAt has passed", async () => {
        const { store, buffer, run } = await setup();
        await store.putSyncState("acct", {
          ...(await store.getSyncState("acct")),
          retryAt: NOW,
        });
        expect((await run()).ok).toBe(true);
        expect(buffer).toHaveBeenCalled();
      });
    });
  }
});

describe("retryJob", () => {
  it("fails when the job is not the caller's", async () => {
    const { deps } = makeSyncDeps();
    const r = await retryJob(deps, "acct", "nope");
    expect(r.ok).toBe(false);
  });
});
