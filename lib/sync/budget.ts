import {
  BUDGET_RESERVE,
  HEARTBEAT_FALLBACK_MS,
  HEARTBEAT_MAX_MS,
  HEARTBEAT_MIN_MS,
  LIVE_MIN_REMAINING,
} from "../constants";
import type { RateLimitSnapshot } from "../types";

export function heartbeatMs(args: {
  snapshot: RateLimitSnapshot | null;
  activeAccounts: number;
  dueSyncsPerDay: number;
  now: number;
}): number {
  const { snapshot, activeAccounts, dueSyncsPerDay, now } = args;
  if (!snapshot) return HEARTBEAT_FALLBACK_MS;
  let worst: number | null = null;
  for (const w of snapshot.windows) {
    const elapsedS = (now - snapshot.observedAt) / 1000;
    if (elapsedS >= w.resetSeconds) continue;
    const resetLeftS = w.resetSeconds - elapsedS;
    const perAccount =
      (w.remaining * (1 - BUDGET_RESERVE)) / Math.max(1, activeAccounts);
    const heartbeats = perAccount - dueSyncsPerDay * (resetLeftS / 86400);
    const intervalMs =
      heartbeats <= 0 ? resetLeftS * 1000 : (resetLeftS / heartbeats) * 1000;
    worst = worst === null ? intervalMs : Math.max(worst, intervalMs);
  }
  if (worst === null) return HEARTBEAT_FALLBACK_MS;
  return Math.min(HEARTBEAT_MAX_MS, Math.max(HEARTBEAT_MIN_MS, worst));
}

export function liveAllowed(
  snapshot: RateLimitSnapshot | null,
  now: number,
): boolean {
  void now;
  if (!snapshot) return true;
  return snapshot.windows.every((w) => w.remaining >= LIVE_MIN_REMAINING);
}
