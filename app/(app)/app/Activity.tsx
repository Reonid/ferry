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
import ui from "@/app/components/ui.module.css";
import t from "@/app/components/PostTicket.module.css";
import { retryAction } from "./actions";
import {
  cx,
  FormStatus,
  SubmitButton,
  useFormAction,
  useSectionStatus,
} from "./FormParts";
import styles from "./Activity.module.css";

type Delivery = ActivityEntry["deliveries"][number];

function Retry({
  jobId,
  describedBy,
  onRetried,
}: {
  jobId: string;
  describedBy: string;
  onRetried: () => void;
}) {
  // A retried delivery leaves "failed", and this button goes with it.
  const { result, pending, onSubmit } = useFormAction(retryAction, {
    onResult: (answer) => {
      if (answer.ok) onRetried();
    },
  });
  return (
    <form onSubmit={onSubmit} className={styles.retry}>
      <input type="hidden" name="jobId" value={jobId} />
      <SubmitButton
        busy={pending}
        busyLabel="Retrying…"
        small
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
  removed,
  excerptId,
  onRetried,
}: {
  delivery: Delivery;
  destination: string;
  /** The destination is gone, along with its retry job: nothing to retry. */
  removed: boolean;
  excerptId: string;
  onRetried: () => void;
}) {
  const label = STATUS_LABEL[delivery.status];
  // Without a stored link, a ready draft still waits in the tray below.
  const href =
    deliveryHref(delivery) ??
    (delivery.status === "draft_ready" ? "#drafts" : null);
  return (
    <li className={t.delivery}>
      <span className={t.place}>{destination}</span>
      {/* With somewhere to go, the whole stamp is the link. */}
      {href ? (
        <a href={href} className={cx(t.stamp, t[delivery.status])}>
          {label}
        </a>
      ) : (
        <span className={cx(t.stamp, t[delivery.status])}>{label}</span>
      )}
      {delivery.status === "failed" && delivery.reason && (
        <span className={t.reason}>{delivery.reason}</span>
      )}
      {delivery.status === "failed" && delivery.jobId && !removed && (
        <Retry
          jobId={delivery.jobId}
          describedBy={excerptId}
          onRetried={onRetried}
        />
      )}
    </li>
  );
}

function Entry({
  entry,
  destinations,
  now,
  onRetried,
}: {
  entry: ActivityEntry;
  destinations: PublicDestination[];
  now: number;
  onRetried: () => void;
}) {
  const excerptId = useId();
  return (
    <li className={t.ticket}>
      <div className={t.layout}>
        <div className={t.main}>
          <p id={excerptId} className={t.excerpt}>
            “{excerptText(entry.excerpt)}”
          </p>
          <p className={t.source}>
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
        </div>
        <ul className={t.stub}>
          {entry.deliveries.map((d) => (
            <DeliveryRow
              key={d.destinationId}
              delivery={d}
              destination={destinationName(d.destinationId, destinations)}
              removed={!destinations.some((x) => x.id === d.destinationId)}
              excerptId={excerptId}
              onRetried={onRetried}
            />
          ))}
        </ul>
      </div>
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
  // After a retry, focus waits on the heading; the live region below says
  // what happened to the delivery.
  const { heading, report } = useSectionStatus();

  // Announce new entries and status changes; the first render stays quiet.
  useEffect(() => {
    const lines = announcements(seen.current, activity, destinations);
    seen.current = activity;
    if (lines.length > 0 && live.current)
      live.current.textContent = lines.join(" ");
  }, [activity, destinations]);

  return (
    <section id="activity" aria-labelledby="activity-title" className={ui.card}>
      <h2
        id="activity-title"
        ref={heading}
        tabIndex={-1}
        className={ui.heading}
      >
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
              onRetried={() => report(null)}
            />
          ))}
        </ol>
      )}
    </section>
  );
}
