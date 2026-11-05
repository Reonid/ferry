import type { DeliverDeps } from "./deliver";
import { runJob, setPending } from "./deliver";
import { WRITE_AHEAD_MS } from "../constants";

/**
 * Re-dispatches due retry jobs from their saved sentCount. Jobs whose account
 * or destination is gone, or whose destination is broken, are deleted unsent.
 * Returns how many jobs were re-dispatched.
 */
export async function processRetries(args: {
  now: number;
  deps: DeliverDeps;
  limit?: number;
}): Promise<number> {
  const { deps } = args;
  const jobs = await deps.store.dueRetries(args.now, args.limit ?? 20);
  let dispatched = 0;
  for (const job of jobs) {
    const account = await deps.store.getAccount(job.accountId);
    const destination = await deps.store.getDestination(job.destinationId);
    if (
      !account ||
      !destination ||
      (destination.kind === "discord" && destination.status === "broken")
    ) {
      await deps.store.deleteRetry(job.id);
      continue;
    }
    // Write ahead again so a crash mid-send leaves the job due.
    await deps.store.putRetry(job, deps.now() + WRITE_AHEAD_MS);
    await runJob({ deps, account, destination, job });
    dispatched++;
  }
  return dispatched;
}

/** Re-queues a failed job for its owner and dispatches it now. */
export async function retryFailedJob(args: {
  deps: DeliverDeps;
  accountId: string;
  jobId: string;
}): Promise<boolean> {
  const { deps } = args;
  const job = await deps.store.getRetry(args.jobId);
  if (!job || job.accountId !== args.accountId || !job.failed) return false;
  const account = await deps.store.getAccount(job.accountId);
  const destination = await deps.store.getDestination(job.destinationId);
  if (
    !account ||
    !destination ||
    (destination.kind === "discord" && destination.status === "broken")
  ) {
    return false;
  }
  const fresh = { ...job, failed: false, attempts: 0 };
  await deps.store.putRetry(fresh, deps.now() + WRITE_AHEAD_MS);
  await setPending(deps, account, fresh.mirror, destination.id);
  await runJob({ deps, account, destination, job: fresh });
  return true;
}
