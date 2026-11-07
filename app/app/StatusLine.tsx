import { plural, relativeTime } from "@/lib/dashboard/view";
import type { Route } from "@/lib/types";
import styles from "./StatusLine.module.css";

export default function StatusLine({
  routes,
  nextRunAt,
  apiCallsToday,
  now,
}: {
  routes: Route[];
  nextRunAt: number | null;
  apiCallsToday: number;
  now: number;
}) {
  const running = routes.filter((r) => !r.paused).length;
  // An overdue check runs on the next tick or poll: say "now", not "ago".
  const next =
    nextRunAt === null
      ? "not scheduled"
      : relativeTime(Math.max(nextRunAt, now), now);
  return (
    <p className={styles.status}>
      {plural(running, "route", "routes")} running
      <span className={styles.sep}>{" · "}</span>
      Next check {next}
      <span className={styles.sep}>{" · "}</span>
      {plural(apiCallsToday, "API call", "API calls")} today
    </p>
  );
}
