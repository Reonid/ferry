import { describe, expect, it } from "vitest";
import { HEARTBEAT_MAX_MS, OVERDUE_BASE_MS, OVERLAP_MS } from "../constants";
import { account } from "../delivery/test-support";
import { dayKey } from "../time";
import { runSync } from "./runner";
import {
  BufferError,
  NOW,
  channel,
  makeSyncDeps,
  rawPost,
  seed,
} from "./test-support";

describe("runSync", () => {
  it("first sync starts at the earliest activeSince", async () => {
    const { deps, store, buffer } = makeSyncDeps();
    await seed(store, { activeSince: 123_000 });
    await runSync("acct", deps);
    const vars = buffer.mock.calls[0]?.[0].variables;
    expect(vars?.since).toBe(new Date(123_000).toISOString());
    expect(vars?.ch0).toEqual(["ch"]);
  });

  it("delivers a matching sent post and moves the checkpoint", async () => {
    const { deps, store, calls } = makeSyncDeps({ posts: [rawPost()] });
    await seed(store);
    const report = await runSync("acct", deps);
    expect(report.status).toBe("ok");
    expect(report.delivered).toBe(1);
    expect(calls).toHaveLength(1);
    const state = await store.getSyncState("acct");
    expect(state.checkpoint).toBe(NOW);
    expect(state.lastSyncAt).toBe(NOW);
    expect(state.nextRunAt).toBe(report.nextRunAt);
  });

  it("skips the same post on the next sync", async () => {
    const { deps, store, calls, buffer } = makeSyncDeps({
      posts: [rawPost()],
    });
    await seed(store);
    await runSync("acct", deps);
    const second = await runSync("acct", deps);
    expect(second.delivered).toBe(0);
    expect(calls).toHaveLength(1);
    expect(buffer.mock.calls[1]?.[0].variables.since).toBe(
      new Date(NOW - OVERLAP_MS).toISOString(),
    );
  });

  it("unschedules accounts without routes and doesn't call Buffer", async () => {
    const { deps, store, buffer } = makeSyncDeps();
    await store.putAccount(account());
    await store.scheduleSync("acct", NOW);
    const report = await runSync("acct", deps);
    expect(report.status).toBe("no_routes");
    expect(buffer).not.toHaveBeenCalled();
    expect(await store.countScheduled()).toBe(0);
  });

  it("ignores paused routes and broken destinations", async () => {
    const { deps, store, buffer } = makeSyncDeps();
    await seed(store);
    const [r] = await store.listRoutes("acct");
    await store.putRoute({ ...r!, paused: true });
    expect((await runSync("acct", deps)).status).toBe("no_routes");
    expect(buffer).not.toHaveBeenCalled();
  });

  it("marks needs_reauth on 401 and retries in six hours", async () => {
    const { deps, store } = makeSyncDeps(
      {},
      new BufferError("nope", { kind: "auth", status: 401 }),
    );
    await seed(store);
    const report = await runSync("acct", deps);
    expect(report.status).toBe("needs_reauth");
    expect(report.nextRunAt).toBe(NOW + HEARTBEAT_MAX_MS);
    expect((await store.getAccount("acct"))?.status).toBe("needs_reauth");
    const alerts = await store.listAlerts("acct", 10);
    expect(alerts.map((a) => a.key)).toEqual(["buffer-auth"]);
    expect(alerts[0]?.message).toBe(
      "Buffer disconnected Ferry. Sign in again to keep posts crossing.",
    );
  });

  it("reschedules a needs_reauth account without calling Buffer", async () => {
    const { deps, store, buffer } = makeSyncDeps();
    await seed(store);
    await store.putAccount(account({ status: "needs_reauth" }));
    const report = await runSync("acct", deps);
    expect(report.status).toBe("needs_reauth");
    expect(report.nextRunAt).toBe(NOW + HEARTBEAT_MAX_MS);
    expect(buffer).not.toHaveBeenCalled();
  });

  it("waits Retry-After on 429 and keeps the checkpoint", async () => {
    const { deps, store } = makeSyncDeps(
      {},
      new BufferError("slow", {
        kind: "rate_limit",
        status: 429,
        retryAfterMs: 90_000,
      }),
    );
    await seed(store);
    const report = await runSync("acct", deps);
    expect(report.status).toBe("rate_limited");
    expect(report.nextRunAt).toBe(NOW + 90_000);
    expect((await store.getSyncState("acct")).checkpoint).toBeNull();
  });

  it("records retryAt on 429 and clears it after success", async () => {
    const failing = makeSyncDeps(
      {},
      new BufferError("slow", { kind: "rate_limit", retryAfterMs: 90_000 }),
    );
    await seed(failing.store);
    await runSync("acct", failing.deps);
    expect((await failing.store.getSyncState("acct")).retryAt).toBe(
      NOW + 90_000,
    );
    const ok = makeSyncDeps();
    await seed(ok.store);
    await ok.store.putSyncState("acct", {
      ...(await ok.store.getSyncState("acct")),
      retryAt: NOW + 5,
    });
    await runSync("acct", ok.deps);
    expect((await ok.store.getSyncState("acct")).retryAt).toBeNull();
  });

  it("retries other Buffer failures after two minutes", async () => {
    const { deps, store } = makeSyncDeps(
      {},
      new BufferError("down", { kind: "network" }),
    );
    await seed(store);
    const report = await runSync("acct", deps);
    expect(report.status).toBe("error");
    expect(report.nextRunAt).toBe(NOW + 2 * OVERDUE_BASE_MS);
    expect((await store.getSyncState("acct")).checkpoint).toBeNull();
  });

  it("alerts once for a disconnected channel across two syncs", async () => {
    const { deps, store } = makeSyncDeps({
      channels: [channel({ isDisconnected: true })],
    });
    await seed(store);
    const first = await runSync("acct", deps);
    const second = await runSync("acct", deps);
    expect(first.alerts).toBe(1);
    expect(second.alerts).toBe(0);
    const alerts = await store.listAlerts("acct", 10);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.key).toBe("chan-disconnected:ch");
    expect(alerts[0]?.message).toBe(
      "Ferry Dev on Bluesky is disconnected in Buffer, so its posts won't go out.",
    );
  });

  it("alerts for a paused queue and clears it when healthy", async () => {
    const paused = makeSyncDeps({
      channels: [channel({ isQueuePaused: true })],
    });
    await seed(paused.store);
    await runSync("acct", paused.deps);
    expect((await paused.store.listAlerts("acct", 10))[0]?.message).toBe(
      "Ferry Dev on Bluesky's queue is paused in Buffer.",
    );
    // Healthy again: the key is cleared so a later pause alerts again.
    const healthy = makeSyncDeps({ channels: [channel()] });
    await seed(healthy.store);
    await healthy.store.raiseAlertOnce("acct", {
      key: "chan-paused:ch",
      message: "x",
      supportUrl: null,
      at: 1,
    });
    await runSync("acct", healthy.deps);
    expect(
      await healthy.store.raiseAlertOnce("acct", {
        key: "chan-paused:ch",
        message: "y",
        supportUrl: null,
        at: 2,
      }),
    ).toBe(true);
  });

  it("a healthy channel clears its earlier alert from the list", async () => {
    const { deps, store } = makeSyncDeps({ channels: [channel()] });
    await seed(store);
    for (const [at, key] of [
      "chan-disconnected:ch",
      "chan-paused:ch",
      "chan-paused:elsewhere",
    ].entries())
      await store.raiseAlertOnce("acct", {
        key,
        message: key,
        supportUrl: null,
        at,
      });
    await runSync("acct", deps);
    expect((await store.listAlerts("acct", 10)).map((a) => a.key)).toEqual([
      "chan-paused:elsewhere",
    ]);
  });

  it("alerts for an error post with Buffer's help link", async () => {
    const { deps, store } = makeSyncDeps({
      posts: [
        rawPost({
          id: "bad",
          status: "error",
          sentAt: null,
          error: { message: "Too long", supportUrl: "https://help.test/x" },
        }),
      ],
    });
    await seed(store);
    await runSync("acct", deps);
    const [a] = await store.listAlerts("acct", 10);
    expect(a?.key).toBe("post-error:bad");
    expect(a?.message).toBe(
      "Buffer couldn't publish a post to Ferry Dev on Bluesky: Too long",
    );
    expect(a?.supportUrl).toBe("https://help.test/x");
  });

  it("returns locked while another sync holds the lock", async () => {
    const { deps, store, buffer } = makeSyncDeps();
    await seed(store);
    await store.acquireLock("sync:acct", 60_000);
    const report = await runSync("acct", deps);
    expect(report.status).toBe("locked");
    expect(buffer).not.toHaveBeenCalled();
  });

  it("releases the lock after a failure", async () => {
    const { deps, store } = makeSyncDeps(
      {},
      new BufferError("down", { kind: "network" }),
    );
    await seed(store);
    await runSync("acct", deps);
    expect(await store.acquireLock("sync:acct", 1000)).not.toBeNull();
  });

  it("counts API calls and stores the rate-limit snapshot", async () => {
    const rateLimit = {
      observedAt: NOW,
      windows: [{ name: "w", remaining: 90, resetSeconds: 3600 }],
    };
    const { deps, store } = makeSyncDeps({ rateLimit });
    await seed(store);
    await runSync("acct", deps);
    expect(await store.getApiCalls("acct", dayKey(NOW))).toBe(1);
    expect(await store.getRateLimit()).toEqual(rateLimit);
  });

  it("keeps cached channels of organizations it did not query", async () => {
    const { deps, store } = makeSyncDeps();
    await seed(store, {
      channels: [channel(), channel({ id: "other", organizationId: "org2" })],
    });
    await runSync("acct", deps);
    expect((await store.getChannels("acct")).map((c) => c.id).sort()).toEqual([
      "ch",
      "other",
    ]);
  });

  it("counts an overdue upcoming post as an attempt", async () => {
    const { deps, store } = makeSyncDeps({
      upcoming: [
        {
          id: "u",
          channelId: "ch",
          dueAt: new Date(NOW - 1000).toISOString(),
          status: "scheduled",
        },
      ],
    });
    await seed(store);
    const report = await runSync("acct", deps);
    expect((await store.getSyncState("acct")).overdueAttempts).toBe(1);
    expect(report.nextRunAt).toBe(NOW + 2 * OVERDUE_BASE_MS);
  });
});
