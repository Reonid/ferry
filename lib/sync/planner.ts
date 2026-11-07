import {
  CLUSTER_GAP_MS,
  LIVE_INTERVAL_MS,
  OVERDUE_BASE_MS,
  OVERDUE_MAX_MS,
  SETTLE_MS,
} from "../constants";

export type SyncReason = "due" | "overdue" | "live" | "heartbeat";

export function planNextSync(args: {
  now: number;
  upcomingDueAt: number[];
  overdueAttempts: number;
  heartbeatMs: number;
  liveUntil: number | null;
  liveAllowed: boolean;
}): { at: number; reason: SyncReason } {
  const { now } = args;
  // Listed in tie-break order.
  const candidates: { at: number; reason: SyncReason }[] = [];

  const future = args.upcomingDueAt
    .filter((t) => t > now)
    .sort((a, b) => a - b);
  const first = future[0];
  if (first !== undefined) {
    let last = first;
    for (const t of future) {
      if (t - last > CLUSTER_GAP_MS) break;
      last = t;
    }
    candidates.push({ at: last + SETTLE_MS, reason: "due" });
  }

  if (args.upcomingDueAt.some((t) => t <= now)) {
    const backoff = Math.min(
      OVERDUE_BASE_MS * 2 ** args.overdueAttempts,
      OVERDUE_MAX_MS,
    );
    candidates.push({ at: now + backoff, reason: "overdue" });
  }

  if (args.liveAllowed && args.liveUntil !== null && args.liveUntil > now) {
    candidates.push({ at: now + LIVE_INTERVAL_MS, reason: "live" });
  }

  candidates.push({ at: now + args.heartbeatMs, reason: "heartbeat" });

  let best = candidates[0]!;
  for (const c of candidates) if (c.at < best.at) best = c;
  return best;
}
