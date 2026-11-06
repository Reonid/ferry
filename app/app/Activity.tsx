"use client";

import { useEffect, useId, useRef } from "react";
import {
  announcements,
  deliveryHref,
  destinationName,
  excerptText,
  relativeTime,
  STATUS_LABEL,
} from "@/lib/dashboard/view";
import { serviceLabel } from "@/lib/mirror/services";
import type { ActivityEntry, PublicDestination } from "@/lib/types";
import ui from "../components/ui.module.css";
import { retryAction } from "./actions";
import { cx, FormStatus, SubmitButton, useFormAction } from "./FormParts";
import styles from "./Activity.module.css";

type Delivery = ActivityEntry["deliveries"][number];

function Retry({ jobId, describedBy }: { jobId: string; describedBy: string }) {
  const { result, pending, onSubmit } = useFormAction(retryAction);
  return (
    <form onSubmit={onSubmit} className={styles.retry}>
      <input type="hidden" name="jobId" value={jobId} />
      <SubmitButton
        busy={pending}
        busyLabel="Retrying…"
        describedBy={describedBy}
      >
        Retry
      </SubmitButton>
      <FormStatus result={result} />
    </form>
  );
}

function DeliveryRow({
  delivery,
  destination,
  excerptId,
}: {
  delivery: Delivery;
  destination: string;
  excerptId: string;
}) {
  const label = STATUS_LABEL[delivery.status];
  // Without a stored link, a ready draft still waits in the tray below.
  const href =
    deliveryHref(delivery) ??
    (delivery.status === "draft_ready" ? "#drafts" : null);
  return (
    <li className={styles.delivery}>
      <span className={styles.destination}>{destination}</span>
      <span className={cx(styles.state, styles[delivery.status])}>
        {href ? <a href={href}>{label}</a> : label}
      </span>
      {delivery.status === "failed" && delivery.reason && (
        <span className={styles.reason}>{delivery.reason}</span>
      )}
      {delivery.status === "failed" && delivery.jobId && (
        <Retry jobId={delivery.jobId} describedBy={excerptId} />
      )}
    </li>
  );
}

function Entry({
  entry,
  destinations,
  now,
}: {
  entry: ActivityEntry;
  destinations: PublicDestination[];
  now: number;
}) {
  const excerptId = useId();
  return (
    <li className={styles.entry}>
      <p id={excerptId} className={styles.excerpt}>
        “{excerptText(entry.excerpt)}”
      </p>
      <p className={styles.source}>
        {entry.source.name} on {serviceLabel(entry.source.service)}
        {entry.publishedAt > 0 && (
          <>
            ,{" "}
            <time dateTime={new Date(entry.publishedAt).toISOString()}>
              {relativeTime(entry.publishedAt, now)}
            </time>
          </>
        )}
      </p>
      <ul className={styles.deliveries}>
        {entry.deliveries.map((d) => (
          <DeliveryRow
            key={d.destinationId}
            delivery={d}
            destination={destinationName(d.destinationId, destinations)}
            excerptId={excerptId}
          />
        ))}
      </ul>
    </li>
  );
}

export default function Activity({
  activity,
  destinations,
  now,
}: {
  activity: ActivityEntry[];
  destinations: PublicDestination[];
  now: number;
}) {
  const live = useRef<HTMLParagraphElement>(null);
  const seen = useRef<ActivityEntry[] | null>(null);

  // Announce new entries and status changes; the first render stays quiet.
  useEffect(() => {
    const lines = announcements(seen.current, activity, destinations);
    seen.current = activity;
    if (lines.length > 0 && live.current)
      live.current.textContent = lines.join(" ");
  }, [activity, destinations]);

  return (
    <section
      id="activity"
      aria-labelledby="activity-title"
      className={ui.section}
    >
      <h2 id="activity-title" className={ui.heading}>
        Activity
      </h2>
      <p
        ref={live}
        aria-live="polite"
        className="visually-hidden"
        data-activity-live=""
      />
      {activity.length === 0 ? (
        <p className={styles.empty}>
          Nothing has crossed yet. Each post shows up here once Buffer publishes
          it.
        </p>
      ) : (
        <ol className={styles.list}>
          {activity.map((entry) => (
            <Entry
              key={entry.groupKey}
              entry={entry}
              destinations={destinations}
              now={now}
            />
          ))}
        </ol>
      )}
    </section>
  );
}
