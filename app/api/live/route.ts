import { loadDashboard } from "@/lib/dashboard/snapshot";
import { LIVE_WINDOW_MS } from "@/lib/constants";
import { getSession } from "@/lib/session";
import { getStore } from "@/lib/store";
import { shouldSyncLive } from "@/lib/sync/live";
import { productionDeps } from "@/lib/sync/production";
import { runSync } from "@/lib/sync/runner";

export const maxDuration = 60;

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

  if (
    shouldSyncLive({
      accountId,
      state,
      snapshot: await store.getRateLimit(),
      now,
    })
  ) {
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
