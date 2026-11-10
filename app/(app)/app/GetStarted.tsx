"use client";

import { useState, type ReactNode } from "react";
import { routable } from "@/lib/dashboard/view";
import type { ActivityEntry, PublicDestination, Route } from "@/lib/types";
import { ChatIcon, CheckIcon } from "@/app/components/icons";
import ui from "@/app/components/ui.module.css";
import { sendLatestAction } from "./actions";
import { cx, FormStatus, SubmitButton, useFormAction } from "./FormParts";
import styles from "./GetStarted.module.css";

/** Step 3's own button: the route's Send my latest post, one click away. */
function SendLatest({ routeId }: { routeId: string }) {
  const { result, pending, onSubmit } = useFormAction(sendLatestAction);
  return (
    <form onSubmit={onSubmit} className={styles.send}>
      <input type="hidden" name="routeId" value={routeId} />
      <SubmitButton variant="primary" small busy={pending} busyLabel="Sending…">
        Send my latest post
      </SubmitButton>
      <FormStatus result={result} />
    </form>
  );
}

/** Whether a post has made it across: delivered, or waiting as a draft. */
function arrived(activity: ActivityEntry[]): boolean {
  return activity.some((entry) =>
    entry.deliveries.some(
      (d) => d.status === "delivered" || d.status === "draft_ready",
    ),
  );
}

/**
 * The three steps to a first delivery, at the top of a new account's
 * dashboard: a place for posts to go, a route there, and a post that has
 * arrived. Each step ticks off as the snapshot shows it done. The current
 * step carries its own action, so the first one is a click, not a hunt.
 */
export default function GetStarted({
  destinations,
  routes,
  activity,
}: {
  destinations: PublicDestination[];
  routes: Route[];
  activity: ActivityEntry[];
}) {
  // The route to try: one that runs, if any does.
  const tryRoute = routes.find((r) => !r.paused) ?? routes[0];
  const steps: {
    name: string;
    text: string;
    action: ReactNode;
    done: boolean;
  }[] = [
    {
      name: "Add a destination",
      text: "Connect a Discord channel or a Telegram chat, or add a subreddit for drafts.",
      action: (
        <>
          <a
            href="/api/discord/connect"
            className={cx(ui.button, ui.primary, ui.small)}
          >
            <ChatIcon className={styles.icon} />
            Connect a Discord channel
          </a>
          <p className={styles.alt}>
            No Discord server handy?{" "}
            <a href="#destinations">Add a subreddit or a Telegram chat</a>.
          </p>
        </>
      ),
      done: destinations.some(routable),
    },
    {
      name: "Add a route",
      text: "Choose which Buffer channels go there.",
      action: (
        <a href="#routes" className={cx(ui.button, ui.primary, ui.small)}>
          Go to Routes
        </a>
      ),
      done: routes.length > 0,
    },
    {
      name: "See a post arrive",
      text: "Your next post arrives once Buffer publishes it. To try it now, send your latest one.",
      action: tryRoute ? <SendLatest routeId={tryRoute.id} /> : null,
      done: arrived(activity),
    },
  ];
  const current = steps.findIndex((step) => !step.done);
  // A guide that was open when the page loaded stays to mark the first
  // crossing; a page loaded after that doesn't show it at all.
  const [guiding] = useState(current !== -1);
  if (current === -1) {
    if (!guiding) return null;
    return (
      <section
        aria-labelledby="start-title"
        className={cx(ui.card, styles.start, styles.finished)}
      >
        <span className={styles.port} aria-hidden="true">
          <CheckIcon />
        </span>
        <div className={styles.head}>
          <h2 id="start-title" className={ui.heading}>
            Your first post crossed
          </h2>
          <p className={ui.hint}>
            Ferry carries every post on your routes from now on. Each one shows
            up under Activity.
          </p>
        </div>
      </section>
    );
  }
  return (
    <section
      aria-labelledby="start-title"
      className={cx(ui.card, styles.start)}
    >
      <div className={styles.head}>
        <h2 id="start-title" className={ui.heading}>
          Get started
        </h2>
        <p className={ui.hint}>Three steps to your first delivery.</p>
      </div>
      {/* role="list" keeps list semantics in Safari despite list-style: none. */}
      <ol role="list" className={styles.steps}>
        {steps.map((step, i) => (
          <li
            key={step.name}
            className={cx(
              styles.step,
              step.done && styles.done,
              i === current && styles.current,
            )}
            aria-current={i === current ? "step" : undefined}
          >
            <span className={styles.port} aria-hidden="true">
              {step.done ? <CheckIcon /> : i + 1}
            </span>
            <div className={styles.body}>
              <p className={styles.name}>
                {step.name}
                {step.done && <span className="visually-hidden">, done</span>}
              </p>
              <p className={styles.text}>{step.text}</p>
              {i === current && step.action}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
