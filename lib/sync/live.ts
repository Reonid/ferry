import { LIVE_INTERVAL_MS } from "../constants";
import type { RateLimitSnapshot, SyncState } from "../types";
import { liveAllowed } from "./budget";

const DEV_ACCOUNT_ID = "dev-account";

/** Whether /api/live should run a sync inline. Respects failure backoff (retryAt). */
export function shouldSyncLive(args: {
  accountId: string;
  state: SyncState;
  snapshot: RateLimitSnapshot | null;
  now: number;
}): boolean {
  const { accountId, state, snapshot, now } = args;
  if (accountId === DEV_ACCOUNT_ID) return false;
  if (state.retryAt !== null && now < state.retryAt) return false;
  if (state.nextRunAt === null || state.nextRunAt <= now) return true;
  return (
    liveAllowed(snapshot, now) &&
    (state.lastSyncAt === null || now - state.lastSyncAt >= LIVE_INTERVAL_MS)
  );
}
