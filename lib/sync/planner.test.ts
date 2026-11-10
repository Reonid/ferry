import { describe, expect, it } from "vitest";
import { planNextSync } from "./planner";

const T = Date.UTC(2026, 10, 5, 12);
const MIN = 60_000;
const base = {
  now: T,
  upcomingDueAt: [] as number[],
  overdueAttempts: 0,
  heartbeatMs: 2 * 60 * MIN,
  liveUntil: null as number | null,
  liveAllowed: true,
};

describe("planNextSync", () => {
  it("runs one sync after a cluster", () => {
    expect(
      planNextSync({
        ...base,
        upcomingDueAt: [T + 13 * MIN, T + 10 * MIN, T + 30 * MIN, T + 11 * MIN],
      }),
    ).toEqual({ at: T + 14 * MIN, reason: "due" });
  });

  it("backs off on overdue posts", () => {
    const plan = (overdueAttempts: number) =>
      planNextSync({ ...base, upcomingDueAt: [T - MIN], overdueAttempts });
    expect(plan(0)).toEqual({ at: T + 60_000, reason: "overdue" });
    expect(plan(3)).toEqual({ at: T + 480_000, reason: "overdue" });
    expect(plan(10)).toEqual({ at: T + 30 * MIN, reason: "overdue" });
  });

  it("prefers live mode while open", () => {
    expect(planNextSync({ ...base, liveUntil: T + 30_000 })).toEqual({
      at: T + 45_000,
      reason: "live",
    });
  });

  it("ignores live mode when not allowed or expired", () => {
    expect(
      planNextSync({ ...base, liveUntil: T + 30_000, liveAllowed: false })
        .reason,
    ).toBe("heartbeat");
    expect(planNextSync({ ...base, liveUntil: T }).reason).toBe("heartbeat");
  });

  it("falls back to the heartbeat", () => {
    expect(planNextSync(base)).toEqual({
      at: T + 120 * MIN,
      reason: "heartbeat",
    });
  });

  it("prefers due over the heartbeat on a tie", () => {
    expect(
      planNextSync({ ...base, upcomingDueAt: [T + 1000], heartbeatMs: 61_000 }),
    ).toEqual({ at: T + 61_000, reason: "due" });
  });
});
