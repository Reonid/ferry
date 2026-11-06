import { describe, expect, it, vi } from "vitest";
import { WRITE_AHEAD_MS } from "../constants";
import { mirror } from "../delivery/test-support";
import { runTick } from "./tick";
import { NOW, makeSyncDeps, seed } from "./test-support";

describe("runTick", () => {
  it("syncs due accounts in order and stops at the budget", async () => {
    const { deps, store, buffer } = makeSyncDeps();
    await seed(store);
    await store.scheduleSync("acct", NOW - 2);
    await store.scheduleSync("b", NOW - 1);
    await store.putAccount({
      ...(await store.getAccount("acct"))!,
      accountId: "b",
    });
    await store.putRoute({
      ...(await store.listRoutes("acct"))[0]!,
      id: "rb",
      accountId: "b",
    });
    let t = NOW;
    const slowBuffer: typeof deps.buffer = async (args) => {
      t += 60_000; // each Buffer call burns a minute of the budget
      return buffer.getMockImplementation()!(args);
    };
    const result = await runTick({
      now: () => t,
      deps: { ...deps, now: () => t, buffer: slowBuffer },
      budgetMs: 45_000,
    });
    expect(result.synced).toBe(1);
    expect(await store.dueAccounts(NOW, 10)).toEqual(["b"]);
  });

  it("processes retries after syncing", async () => {
    const { deps, store, calls } = makeSyncDeps();
    await seed(store);
    await store.putRetry(
      {
        id: "d1|g1",
        accountId: "acct",
        destinationId: "d1",
        groupKey: "g1",
        mirror: mirror(),
        attempts: 0,
        sentCount: 0,
        failed: false,
      },
      NOW - 1,
    );
    const result = await runTick({ now: () => NOW, deps });
    expect(result.retried).toBe(1);
    expect(calls).toHaveLength(1);
    void WRITE_AHEAD_MS;
  });

  it("a second overlapping tick does nothing", async () => {
    const { deps, store, buffer } = makeSyncDeps();
    await seed(store);
    await store.scheduleSync("acct", NOW - 1);
    await store.putRetry(
      {
        id: "d1|g1",
        accountId: "acct",
        destinationId: "d1",
        groupKey: "g1",
        mirror: mirror(),
        attempts: 0,
        sentCount: 0,
        failed: false,
      },
      NOW - 1,
    );
    // The first tick stops inside its Buffer call until released.
    const healthy = buffer.getMockImplementation()!;
    let entered = () => {};
    const inBuffer = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    buffer.mockImplementation(async (args) => {
      entered();
      await gate;
      return healthy(args);
    });

    const first = runTick({ now: () => NOW, deps });
    await inBuffer;
    expect(await runTick({ now: () => NOW, deps })).toEqual({
      synced: 0,
      retried: 0,
    });
    expect(buffer).toHaveBeenCalledTimes(1);

    release();
    expect(await first).toEqual({ synced: 1, retried: 1 });
    expect(await store.acquireLock("tick", 1000)).not.toBeNull();
  });

  it("keeps going and logs only the error name when a sync throws", async () => {
    const { deps, store } = makeSyncDeps();
    await seed(store);
    await store.scheduleSync("acct", NOW - 1);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const boom = new TypeError("secret post text");
    deps.getAccessToken = async () => {
      throw boom;
    };
    const result = await runTick({ now: () => NOW, deps });
    expect(result.synced).toBe(0);
    expect(spy).toHaveBeenCalledWith("ferry: sync failed (TypeError)");
    expect(JSON.stringify(spy.mock.calls)).not.toContain("secret");
    spy.mockRestore();
  });
});
