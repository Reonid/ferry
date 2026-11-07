import type { DeliverDeps } from "./deliver";
import { failJob, runJob, setPending } from "./deliver";
import { MAX_ATTEMPTS, WRITE_AHEAD_MS } from "../constants";

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
  let firstError: unknown;
  let hasError = false;
  for (const job of jobs) {
    try {
      // Still due at the cap means a run was cut off after writing ahead,
      // by a crash or a timeout. Fail it rather than run it again.
      if (job.attempts >= MAX_ATTEMPTS) {
        await failJob(deps, job, "Unexpected error while delivering.");
        continue;
      }
      // Write ahead first and count this run as an attempt, so a job whose
      // dispatch keeps throwing still reaches the attempt cap.
      await deps.store.putRetry(
        { ...job, attempts: job.attempts + 1 },
        deps.now() + WRITE_AHEAD_MS,
      );
      try {
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
        await runJob({ deps, account, destination, job });
        dispatched++;
      } catch (err) {
        if (job.attempts + 1 >= MAX_ATTEMPTS) {
          await failJob(
            deps,
            { ...job, attempts: job.attempts + 1 },
            "Unexpected error while delivering.",
          );
        }
        throw err;
      }
    } catch (err) {
      if (!hasError) {
        hasError = true;
        firstError = err;
      }
    }
  }
  if (hasError) throw firstError;
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
