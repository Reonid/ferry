import { loadDashboard } from "@/lib/dashboard/snapshot";
import { LIVE_INTERVAL_MS, LIVE_WINDOW_MS } from "@/lib/constants";
import { getSession } from "@/lib/session";
import { getStore } from "@/lib/store";
import { liveAllowed } from "@/lib/sync/budget";
import { productionDeps } from "@/lib/sync/production";
import { runSync } from "@/lib/sync/runner";

const DEV_ACCOUNT_ID = "dev-account";

export async function GET(): Promise<Response> {
  const session = await getSession();
  const accountId = session.accountId;
  if (!accountId) return new Response("Unauthorized", { status: 401 });
  const store = getStore();
  if (!(await store.getAccount(accountId)))
    return new Response("Unauthorized", { status: 401 });

  const now = Date.now();
  const state = await store.getSyncState(accountId);
  await store.putSyncState(accountId, {
    ...state,
    liveUntil: now + LIVE_WINDOW_MS,
  });

  const due = state.nextRunAt === null || state.nextRunAt <= now;
  const liveDue =
    liveAllowed(await store.getRateLimit(), now) &&
    (state.lastSyncAt === null || now - state.lastSyncAt >= LIVE_INTERVAL_MS);
  if (accountId !== DEV_ACCOUNT_ID && (due || liveDue)) {
    try {
      await runSync(accountId, productionDeps());
    } catch (err) {
      console.error(
        `ferry: live sync failed (${err instanceof Error ? err.name : "UnknownError"})`,
      );
    }
  }
  return Response.json(await loadDashboard(accountId, store, Date.now()));
}
