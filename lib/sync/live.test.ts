import { describe, expect, it } from "vitest";
import { LIVE_INTERVAL_MS } from "../constants";
import type { SyncState } from "../types";
import { shouldSyncLive } from "./live";

const NOW = 10_000_000;
const state = (over: Partial<SyncState> = {}): SyncState => ({
  checkpoint: null,
  overdueAttempts: 0,
  lastSyncAt: NOW - 1000,
  nextRunAt: NOW + 3_600_000,
  liveUntil: null,
  lastSendLatestAt: null,
  retryAt: null,
  ...over,
});
const run = (accountId: string, s: SyncState) =>
  shouldSyncLive({ accountId, state: s, snapshot: null, now: NOW });

describe("shouldSyncLive", () => {
  it("never syncs the dev account", () => {
    expect(run("dev-account", state({ nextRunAt: null }))).toBe(false);
  });
  it("waits for retryAt after a failure", () => {
    const s = state({
      nextRunAt: NOW - 1,
      lastSyncAt: null,
      retryAt: NOW + 5000,
    });
    expect(run("a", s)).toBe(false);
    expect(run("a", { ...s, retryAt: NOW })).toBe(true);
  });
  it("syncs when the schedule is due", () => {
    expect(run("a", state({ nextRunAt: null }))).toBe(true);
    expect(run("a", state({ nextRunAt: NOW }))).toBe(true);
  });
  it("syncs in live mode after the interval", () => {
    expect(run("a", state({ lastSyncAt: NOW - LIVE_INTERVAL_MS }))).toBe(true);
  });
  it("doesn't sync in live mode before the interval", () => {
    expect(run("a", state({ lastSyncAt: NOW - LIVE_INTERVAL_MS + 1 }))).toBe(
      false,
    );
  });
});
