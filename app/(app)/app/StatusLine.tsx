import { plural, relativeTime, type SyncMode } from "@/lib/dashboard/view";
import styles from "./StatusLine.module.css";

export { syncMode, type SyncMode } from "@/lib/dashboard/view";

/** When Ferry next asks Buffer. An overdue check runs on the next tick or poll. */
function nextCheck(nextRunAt: number | null, now: number): string {
  if (nextRunAt === null) return "No check scheduled";
  if (nextRunAt <= now) return "Checking now";
  return `Next check ${relativeTime(nextRunAt, now)}`;
}

/**
 * One quiet line beside the status pill: when Ferry next asks Buffer, and
 * how much of Buffer's API it has used today. Before a first route, or
 * while Buffer has signed Ferry out, it says why nothing is checked.
 */
export default function StatusLine({
  mode,
  nextRunAt,
  apiCallsToday,
  now,
}: {
  mode: SyncMode;
  nextRunAt: number | null;
  apiCallsToday: number;
  now: number;
}) {
  const text =
    mode === "empty"
      ? "Ferry starts checking Buffer when you add your first route."
      : mode === "reauth"
        ? "Checks are stopped until you sign in again."
        : mode === "paused"
          ? "Every route is paused."
          : `${nextCheck(nextRunAt, now)} · ${plural(apiCallsToday, "Buffer API call", "Buffer API calls")} today`;
  return (
    <p className={styles.line} data-sync-line="">
      {text}
    </p>
  );
}
