"use client";

import { useId, useState, type ReactNode } from "react";
import { channelName, routable, routeLabel } from "@/lib/dashboard/view";
import { serviceLabel } from "@/lib/mirror/services";
import type { ActionResult } from "@/lib/routes/manage";
import type { Channel, PublicDestination, Route } from "@/lib/types";
import ui from "@/app/components/ui.module.css";
import {
  createRouteAction,
  deleteRouteAction,
  sendLatestAction,
  toggleRouteAction,
} from "./actions";
import {
  cx,
  FormStatus,
  SectionStatus,
  SubmitButton,
  useFormAction,
  useSectionStatus,
} from "./FormParts";
import styles from "./RouteList.module.css";

/** What a route there makes, after the destination's name in the picker. */
const KIND_NAME: Record<PublicDestination["kind"], string> = {
  discord: "Discord",
  reddit: "Reddit draft",
  telegram: "Telegram",
};

const COPY_TIP =
  "Copies of a post with the same text arrive once, within 24 hours. If you write different text for each network, pick just one of those channels.";

/** One form per route: the button that submits it picks the action. */
async function routeAction(
  prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  switch (formData.get("intent")) {
    case "toggle": {
      const result = await toggleRouteAction(prev, formData);
      if (!result.ok) return result;
      const paused = formData.get("paused") === "true";
      return { ok: true, message: paused ? "Route paused." : "Route resumed." };
    }
    case "send":
      return sendLatestAction(prev, formData);
    case "delete":
      return deleteRouteAction(prev, formData);
    default:
      return { ok: false, error: "Reload the page and try again." };
  }
}

/**
 * A route as one line: its lane, where it goes, and how it's doing. The
 * line opens to the route's controls, so the list stays calm until
 * someone wants to change something.
 */
function RouteRow({
  route,
  label,
  broken,
  onDeleted,
}: {
  route: Route;
  label: string;
  /** Its destination stopped accepting posts, as the map's red lane shows. */
  broken: boolean;
  onDeleted: () => void;
}) {
  const { result, pending, intent, onSubmit } = useFormAction(routeAction, {
    // A deleted row takes its status line with it; the section reports.
    onResult: (answer, formData) => {
      if (answer.ok && formData.get("intent") === "delete") onDeleted();
    },
  });
  const nameId = useId();
  const busy = (name: string) => pending && intent === name;
  const tagged = route.tagNames.length > 0;
  return (
    <li
      className={cx(
        styles.route,
        route.paused && styles.paused,
        broken && styles.broken,
      )}
    >
      <details>
        <summary className={cx(ui.row, styles.summary)}>
          <svg className={styles.lane} viewBox="0 0 28 8" aria-hidden="true">
            <path d="M 2 4 H 26" />
          </svg>
          <span className={styles.what}>
            <span id={nameId} className={styles.name}>
              {label}
            </span>
            {tagged && (
              <span className={styles.meta}>
                Only posts tagged{" "}
                {route.tagNames.map((tag, i) => (
                  <span key={tag}>
                    {i > 0 && <span className="visually-hidden">, </span>}
                    <span className={styles.tag}>{tag}</span>{" "}
                  </span>
                ))}
              </span>
            )}
            {broken && (
              <span className={cx(styles.meta, styles.problem)}>
                Its destination stopped accepting posts: reconnect it under
                Destinations, then resume.
              </span>
            )}
          </span>
          <span className={styles.state}>
            {broken ? "Broken" : route.paused ? "Paused" : "Running"}
          </span>
        </summary>
        <form onSubmit={onSubmit} className={styles.tools}>
          <input type="hidden" name="routeId" value={route.id} />
          <input type="hidden" name="paused" value={String(!route.paused)} />
          <SubmitButton
            intent="toggle"
            busy={busy("toggle")}
            small
            describedBy={nameId}
          >
            {route.paused ? "Resume" : "Pause"}
          </SubmitButton>
          <SubmitButton
            intent="send"
            busy={busy("send")}
            busyLabel="Sending…"
            small
            describedBy={nameId}
          >
            Send my latest post
          </SubmitButton>
          <span className={styles.end}>
            <SubmitButton
              intent="delete"
              busy={busy("delete")}
              busyLabel="Deleting…"
              variant="quiet-danger"
              small
              describedBy={nameId}
            >
              Delete route
            </SubmitButton>
          </span>
        </form>
      </details>
      <FormStatus result={result} className={styles.result} />
    </li>
  );
}

function CreateRoute({
  channels,
  destinations,
  startOpen,
}: {
  channels: Channel[];
  destinations: PublicDestination[];
  startOpen: boolean;
}) {
  const { result, pending, onSubmit } = useFormAction(createRouteAction, {
    resetOnSuccess: true,
  });
  const tipId = useId();
  const toId = useId();
  const tagsId = useId();
  const tagsHintId = useId();
  const firstActive = destinations.find((d) => d.status === "active");
  return (
    <div className={styles.create}>
      <details open={startOpen}>
        <summary className={cx(ui.button, ui.disclosure, ui.adds, ui.adder)}>
          New route
        </summary>
        <form
          onSubmit={onSubmit}
          className={styles.form}
          aria-label="New route"
        >
          <fieldset className={styles.channels} aria-describedby={tipId}>
            <legend className={ui.label}>From</legend>
            {channels.length === 0 ? (
              <p className={ui.hint}>
                Ferry has no Buffer channels for you yet. Use Refresh channels
                in Settings.
              </p>
            ) : (
              channels.map((c) => (
                <label key={c.id} className={styles.check}>
                  <input
                    // A new input when the lock changes, so a box ticked
                    // before its channel locked isn't left ticked but unsent.
                    key={c.isLocked ? "locked" : "open"}
                    type="checkbox"
                    name="channelIds"
                    value={c.id}
                    disabled={c.isLocked}
                  />
                  {channelName(c)} on {serviceLabel(c.service)}
                  {c.isLocked ? ", locked in Buffer" : ""}
                </label>
              ))
            )}
            <p id={tipId} className={ui.hint}>
              {COPY_TIP}
            </p>
          </fieldset>
          <div className={ui.field}>
            <label htmlFor={toId} className={ui.label}>
              To
            </label>
            <select
              id={toId}
              name="destinationId"
              className={ui.input}
              defaultValue={firstActive?.id ?? ""}
            >
              {destinations.map((d) => (
                <option
                  key={d.id}
                  value={d.id}
                  disabled={d.status !== "active"}
                >
                  {d.label} ({KIND_NAME[d.kind]}
                  {d.status !== "active" ? ", reconnect first" : ""})
                </option>
              ))}
            </select>
          </div>
          <div className={ui.field}>
            <label htmlFor={tagsId} className={ui.label}>
              Only posts tagged
            </label>
            <input
              id={tagsId}
              name="tags"
              type="text"
              className={ui.input}
              autoComplete="off"
              aria-describedby={tagsHintId}
            />
            <p id={tagsHintId} className={ui.hint}>
              Optional. Leave it empty for every post, or list Buffer tags
              separated by commas.
            </p>
          </div>
          <div>
            <SubmitButton variant="primary" busy={pending} busyLabel="Adding…">
              Add route
            </SubmitButton>
          </div>
        </form>
      </details>
      <FormStatus result={result} />
    </div>
  );
}

/**
 * Where posts go: how Ferry is doing, the map of every route, then the
 * routes themselves, one line each. The map is the picture; the list is
 * its interactive twin, each lane drawn the way the map draws it.
 */
export default function RouteList({
  routes,
  channels,
  destinations,
  status,
  map,
}: {
  routes: Route[];
  channels: Channel[];
  destinations: PublicDestination[];
  /** How Ferry is doing, beside the heading. */
  status: ReactNode;
  map: ReactNode;
}) {
  // Open the form when there's nothing yet; after that, people choose.
  const [startOpen] = useState(routes.length === 0);
  const { heading, message, report } = useSectionStatus();
  // A Telegram DM takes alerts only, so no route can go there.
  const targets = destinations.filter(routable);
  return (
    <section id="routes" aria-labelledby="routes-title" className={ui.card}>
      <div className={ui.cardHead}>
        <h2
          id="routes-title"
          ref={heading}
          tabIndex={-1}
          className={ui.heading}
        >
          Routes
        </h2>
        {status}
      </div>
      <SectionStatus message={message} />
      {map}
      {targets.length === 0 ? (
        <div className={styles.empty}>
          <p>
            A route carries posts from your Buffer channels to a destination.
            Add one first: a Discord channel, a Telegram channel or group, or a
            subreddit.
          </p>
          <a href="#destinations" className={cx(ui.button, ui.small)}>
            Go to Destinations
          </a>
        </div>
      ) : (
        <>
          {routes.length > 0 && (
            <ul className={styles.list}>
              {routes.map((route) => (
                <RouteRow
                  key={route.id}
                  route={route}
                  label={routeLabel(route, channels, destinations)}
                  broken={destinations.some(
                    (d) =>
                      d.id === route.destinationId && d.status === "broken",
                  )}
                  onDeleted={() => report("Route deleted.")}
                />
              ))}
            </ul>
          )}
          <CreateRoute
            channels={channels}
            destinations={targets}
            startOpen={startOpen}
          />
        </>
      )}
    </section>
  );
}
