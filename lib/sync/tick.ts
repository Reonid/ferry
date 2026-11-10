import { TICK_BUDGET_MS, TICK_LOCK_MS, TICK_MAX_ACCOUNTS } from "../constants";
import { processRetries } from "../delivery/retries";
import { runSync, type SyncDeps } from "./runner";

function logFailure(what: string, err: unknown): void {
  // Only the error's name: messages can carry tokens or post text.
  const name = err instanceof Error ? err.name : "UnknownError";
  console.error(`ferry: ${what} failed (${name})`);
}

/** One tick at a time: a tick that finds another running does nothing. */
export async function runTick(args: {
  now: () => number;
  deps: SyncDeps;
  budgetMs?: number;
}): Promise<{ synced: number; retried: number }> {
  const { now, deps } = args;
  const lock = await deps.store.acquireLock("tick", TICK_LOCK_MS);
  if (lock === null) return { synced: 0, retried: 0 };
  try {
    const budget = args.budgetMs ?? TICK_BUDGET_MS;
    const began = now();
    let synced = 0;
    let retried = 0;
    const ids = await deps.store.dueAccounts(began, TICK_MAX_ACCOUNTS);
    for (const id of ids) {
      if (now() - began >= budget) break;
      try {
        const report = await runSync(id, deps);
        if (report.status !== "locked") synced++;
      } catch (err) {
        logFailure("sync", err);
      }
    }
    try {
      retried = await processRetries({ now: now(), deps });
    } catch (err) {
      logFailure("retries", err);
    }
    return { synced, retried };
  } finally {
    await deps.store.releaseLock("tick", lock);
  }
}
