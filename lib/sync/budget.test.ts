import { describe, expect, it } from "vitest";
import { heartbeatMs, liveAllowed } from "./budget";

const T = Date.UTC(2026, 10, 5, 12);
const snap = (
  windows: { name: string; remaining: number; resetSeconds: number }[],
  observedAt = T,
) => ({
  observedAt,
  windows,
});

describe("heartbeatMs", () => {
  it("uses the fallback without a snapshot", () => {
    expect(
      heartbeatMs({
        snapshot: null,
        activeAccounts: 1,
        dueSyncsPerDay: 0,
        now: T,
      }),
    ).toBe(7_200_000);
  });

  it("matches the spec's worked example", () => {
    expect(
      heartbeatMs({
        snapshot: snap([{ name: "24h", remaining: 250, resetSeconds: 86400 }]),
        activeAccounts: 10,
        dueSyncsPerDay: 4,
        now: T,
      }),
    ).toBe(5_400_000);
  });

  it("clamps to 15 minutes when the budget is plentiful", () => {
    expect(
      heartbeatMs({
        snapshot: snap([{ name: "24h", remaining: 500, resetSeconds: 86400 }]),
        activeAccounts: 1,
        dueSyncsPerDay: 0,
        now: T,
      }),
    ).toBe(900_000);
  });

  it("waits for the reset when exhausted", () => {
    expect(
      heartbeatMs({
        snapshot: snap([{ name: "15m", remaining: 0, resetSeconds: 3600 }]),
        activeAccounts: 1,
        dueSyncsPerDay: 0,
        now: T,
      }),
    ).toBe(3_600_000);
  });

  it("takes the tightest window", () => {
    expect(
      heartbeatMs({
        snapshot: snap([
          { name: "15m", remaining: 100, resetSeconds: 900 },
          { name: "24h", remaining: 250, resetSeconds: 86400 },
        ]),
        activeAccounts: 10,
        dueSyncsPerDay: 4,
        now: T,
      }),
    ).toBe(5_400_000);
  });

  it("ignores windows that already reset", () => {
    expect(
      heartbeatMs({
        snapshot: snap(
          [{ name: "15m", remaining: 0, resetSeconds: 900 }],
          T - 901_000,
        ),
        activeAccounts: 1,
        dueSyncsPerDay: 0,
        now: T,
      }),
    ).toBe(7_200_000);
  });

  it("clamps to six hours at most", () => {
    expect(
      heartbeatMs({
        snapshot: snap([{ name: "24h", remaining: 0, resetSeconds: 80000 }]),
        activeAccounts: 1,
        dueSyncsPerDay: 0,
        now: T,
      }),
    ).toBe(6 * 3_600_000);
  });
});

describe("liveAllowed", () => {
  it("allows without a snapshot", () => {
    expect(liveAllowed(null, T)).toBe(true);
  });

  it("blocks live mode under 20 remaining", () => {
    expect(
      liveAllowed(snap([{ name: "a", remaining: 19, resetSeconds: 900 }]), T),
    ).toBe(false);
    expect(
      liveAllowed(snap([{ name: "a", remaining: 20, resetSeconds: 900 }]), T),
    ).toBe(true);
    expect(
      liveAllowed(
        snap([
          { name: "a", remaining: 500, resetSeconds: 900 },
          { name: "b", remaining: 5, resetSeconds: 900 },
        ]),
        T,
      ),
    ).toBe(false);
  });
});
