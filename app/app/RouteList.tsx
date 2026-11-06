"use client";

import { useId, useState } from "react";
import { channelName, routeLabel } from "@/lib/dashboard/view";
import { serviceLabel } from "@/lib/mirror/services";
import type { ActionResult } from "@/lib/routes/manage";
import type { Channel, PublicDestination, Route } from "@/lib/types";
import ui from "../components/ui.module.css";
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

export const TIMING_NOTE =
  "Scheduled posts cross within about 3 minutes, or about a minute while Ferry is open. Posts you publish right away can take longer unless Ferry is open.";

const COPY_TIP =
  "If you write different text for each network, each version arrives separately. Pick one of those channels to get one message per post. The same text posted again within 24 hours counts as a copy and arrives once.";

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

function RouteRow({
  route,
  label,
  onDeleted,
}: {
  route: Route;
  label: string;
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
  const filter =
    route.tagNames.length > 0
      ? `Only posts tagged ${route.tagNames.join(", ")}`
      : "Every post";
  return (
    <li className={cx(styles.route, route.paused && styles.paused)}>
      <p id={nameId} className={styles.name}>
        {label}
      </p>
      <p className={styles.meta}>
        {route.paused ? `Paused. ${filter}.` : `${filter}.`}
      </p>
      <form onSubmit={onSubmit} className={styles.actions}>
        <input type="hidden" name="routeId" value={route.id} />
        <input type="hidden" name="paused" value={String(!route.paused)} />
        <SubmitButton
          intent="toggle"
          busy={busy("toggle")}
          describedBy={nameId}
        >
          {route.paused ? "Resume" : "Pause"}
        </SubmitButton>
        <SubmitButton
          intent="send"
          busy={busy("send")}
          busyLabel="Sending…"
          describedBy={nameId}
        >
          Send my latest post
        </SubmitButton>
        <SubmitButton
          intent="delete"
          busy={busy("delete")}
          busyLabel="Deleting…"
          variant="danger"
          describedBy={nameId}
        >
          Delete
        </SubmitButton>
      </form>
      <FormStatus result={result} />
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
        <summary className={cx(ui.button, ui.disclosure, ui.adds)}>
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
                  <input type="checkbox" name="channelIds" value={c.id} />
                  {channelName(c)} on {serviceLabel(c.service)}
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
                  {d.label} ({d.kind === "discord" ? "Discord" : "Reddit draft"}
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
              Optional. Buffer tag names, separated by commas. Leave it empty to
              send every post.
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

export default function RouteList({
  routes,
  channels,
  destinations,
}: {
  routes: Route[];
  channels: Channel[];
  destinations: PublicDestination[];
}) {
  // Open the form when there's nothing yet; after that, people choose.
  const [startOpen] = useState(routes.length === 0);
  const { heading, message, report } = useSectionStatus();
  return (
    <section id="routes" aria-labelledby="routes-title" className={ui.section}>
      <h2 id="routes-title" ref={heading} tabIndex={-1} className={ui.heading}>
        Routes
      </h2>
      <SectionStatus message={message} />
      {destinations.length === 0 ? (
        <div className={styles.empty}>
          <p>
            A route carries posts from your Buffer channels to a destination.
            Connect a Discord channel to draw your first one.
          </p>
          <a href="/api/discord/connect" className={cx(ui.button, ui.primary)}>
            Connect a Discord channel
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
                  onDeleted={() => report("Route deleted.")}
                />
              ))}
            </ul>
          )}
          <CreateRoute
            channels={channels}
            destinations={destinations}
            startOpen={startOpen}
          />
        </>
      )}
      <p className={styles.timing}>{TIMING_NOTE}</p>
    </section>
  );
}
