import { plural, relativeTime } from "@/lib/dashboard/view";
import type { Alert } from "@/lib/types";
import ui from "../components/ui.module.css";
import { cx } from "./FormParts";
import styles from "./Alerts.module.css";

/** What the Discord connect callback reported, from the query string. */
export type Notice = "discord-connected" | "discord-denied" | "discord-failed";

const NOTICE_TEXT: Record<Notice, string> = {
  "discord-connected":
    "Discord is connected. Give the channel a name under Destinations so you can tell it apart.",
  "discord-denied": "Discord wasn't connected: the request was cancelled.",
  "discord-failed": "Couldn't connect Discord. Try again.",
};

const SHOWN = 3;

/** Account-level news at the top of the page. */
export function Banner({
  needsReauth,
  notice,
}: {
  needsReauth: boolean;
  notice: Notice | null;
}) {
  if (!needsReauth && notice === null) return null;
  return (
    <div className={styles.banners}>
      {needsReauth && (
        <p className={cx(styles.banner, styles.problem)}>
          Buffer disconnected Ferry.{" "}
          <a href="/api/auth/buffer">Sign in again.</a>
        </p>
      )}
      {notice !== null && (
        <p
          role="status"
          className={cx(
            styles.banner,
            notice !== "discord-connected" && styles.problem,
          )}
        >
          {NOTICE_TEXT[notice]}
        </p>
      )}
    </div>
  );
}

function AlertItem({ alert, now }: { alert: Alert; now: number }) {
  const help =
    alert.supportUrl && /^https:\/\//i.test(alert.supportUrl)
      ? alert.supportUrl
      : null;
  return (
    <li className={styles.alert}>
      <p>{alert.message}</p>
      <p className={styles.when}>
        <time dateTime={new Date(alert.at).toISOString()}>
          {relativeTime(alert.at, now)}
        </time>
        {help && (
          <>
            {". "}
            <a href={help}>Buffer&apos;s help on this</a>
          </>
        )}
      </p>
    </li>
  );
}

export default function Alerts({
  alerts,
  now,
}: {
  alerts: Alert[];
  now: number;
}) {
  if (alerts.length === 0) return null;
  const recent = alerts.slice(0, SHOWN);
  const older = alerts.slice(SHOWN);
  return (
    <section aria-labelledby="alerts-title" className={styles.alerts}>
      <h2 id="alerts-title" className={ui.heading}>
        Needs attention
      </h2>
      <ul className={styles.list}>
        {recent.map((a) => (
          <AlertItem key={`${a.key}-${a.at}`} alert={a} now={now} />
        ))}
      </ul>
      {older.length > 0 && (
        <details>
          <summary className={cx(ui.button, ui.disclosure)}>
            {plural(older.length, "older alert", "older alerts")}
          </summary>
          <ul className={styles.list}>
            {older.map((a) => (
              <AlertItem key={`${a.key}-${a.at}`} alert={a} now={now} />
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
