"use client";

import { useEffect, useRef } from "react";
import { isBrokenDestinationAlert } from "@/lib/alert-keys";
import { plural, relativeTime } from "@/lib/dashboard/view";
import type { Alert } from "@/lib/types";
import ui from "@/app/components/ui.module.css";
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

const alertKey = (alert: Alert) => `${alert.key}-${alert.at}`;

/**
 * Account-level news at the top of the page. The wrapper is a live region
 * that is always mounted, even when empty, so a banner a poll brings in is
 * read out when it appears. Its text never changes while it is shown, so
 * later polls don't read it again.
 */
export function Banner({
  needsReauth,
  notice,
}: {
  needsReauth: boolean;
  notice: Notice | null;
}) {
  return (
    <div className={styles.banners} aria-live="polite" data-banner-live="">
      {needsReauth && (
        <p className={cx(styles.banner, styles.problem)}>
          Buffer disconnected Ferry.{" "}
          <a href="/api/auth/buffer">Sign in again.</a>
        </p>
      )}
      {notice !== null && (
        <p
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
        {/* The fix for a broken destination lives with the destination. */}
        {isBrokenDestinationAlert(alert.key) && (
          <>
            {". "}
            <a href="#destinations">Go to Destinations</a>
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
  const live = useRef<HTMLParagraphElement>(null);
  const seen = useRef<Set<string> | null>(null);

  // Read out each alert once, the first time a poll brings it in. The list
  // itself isn't live: its relative times change as the clock ticks.
  useEffect(() => {
    const before = seen.current;
    seen.current = new Set(alerts.map(alertKey));
    if (before === null) return;
    const fresh = alerts.filter((a) => !before.has(alertKey(a)));
    if (fresh.length > 0 && live.current)
      live.current.textContent = fresh
        .map((a) => `Needs attention: ${a.message}`)
        .join(" ");
  }, [alerts]);

  const recent = alerts.slice(0, SHOWN);
  const older = alerts.slice(SHOWN);
  return (
    <>
      <p
        ref={live}
        aria-live="polite"
        className="visually-hidden"
        data-alerts-live=""
      />
      {alerts.length > 0 && (
        <section aria-labelledby="alerts-title" className={styles.alerts}>
          <h2 id="alerts-title" className={styles.title}>
            Needs attention
          </h2>
          <ul className={styles.list}>
            {recent.map((a) => (
              <AlertItem key={alertKey(a)} alert={a} now={now} />
            ))}
          </ul>
          {older.length > 0 && (
            <details>
              <summary className={cx(ui.button, ui.disclosure)}>
                {plural(older.length, "older alert", "older alerts")}
              </summary>
              <ul className={styles.list}>
                {older.map((a) => (
                  <AlertItem key={alertKey(a)} alert={a} now={now} />
                ))}
              </ul>
            </details>
          )}
        </section>
      )}
    </>
  );
}
