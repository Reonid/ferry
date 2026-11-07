"use client";

import { useId } from "react";
import { plural } from "@/lib/dashboard/view";
import type { ActionResult } from "@/lib/routes/manage";
import type { PublicDestination, Route } from "@/lib/types";
import ui from "../components/ui.module.css";
import {
  addRedditAction,
  removeDestinationAction,
  renameDestinationAction,
} from "./actions";
import {
  cx,
  FormStatus,
  SectionStatus,
  SubmitButton,
  useFormAction,
  useSectionStatus,
} from "./FormParts";
import styles from "./Destinations.module.css";

async function rename(
  prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const result = await renameDestinationAction(prev, formData);
  return result.ok ? { ok: true, message: "Name saved." } : result;
}

function DestinationRow({
  destination,
  routeCount,
  onRemoved,
}: {
  destination: PublicDestination;
  routeCount: number;
  onRemoved: () => void;
}) {
  const renaming = useFormAction(rename);
  // A removed row takes its status line with it; the section reports.
  const removing = useFormAction(removeDestinationAction, {
    onResult: (answer) => {
      if (answer.ok) onRemoved();
    },
  });
  const nameId = useId();
  const inputId = useId();
  const broken = destination.status === "broken";
  return (
    <li className={styles.row}>
      <div className={styles.what}>
        <p id={nameId} className={styles.name}>
          {destination.label}
        </p>
        <p className={styles.kind}>
          {destination.kind === "discord" ? "Discord channel" : "Reddit drafts"}
        </p>
        {broken && (
          <p className={styles.broken}>
            Discord stopped accepting posts here.{" "}
            <a href="/api/discord/connect">Connect the channel again</a>, then
            remove this one.
          </p>
        )}
      </div>
      <div className={styles.tools}>
        <details className={styles.tool}>
          <summary
            className={cx(ui.button, ui.disclosure)}
            aria-describedby={nameId}
          >
            Rename
          </summary>
          <form onSubmit={renaming.onSubmit} className={styles.panel}>
            <input type="hidden" name="destinationId" value={destination.id} />
            <div className={ui.field}>
              <label htmlFor={inputId} className={ui.label}>
                New name
              </label>
              <input
                id={inputId}
                name="label"
                className={ui.input}
                defaultValue={destination.label}
                maxLength={60}
                autoComplete="off"
              />
            </div>
            <div>
              <SubmitButton busy={renaming.pending}>Save name</SubmitButton>
            </div>
            <FormStatus result={renaming.result} />
          </form>
        </details>
        <details className={styles.tool}>
          <summary
            className={cx(ui.button, ui.disclosure)}
            aria-describedby={nameId}
          >
            Remove
          </summary>
          <form onSubmit={removing.onSubmit} className={styles.panel}>
            <input type="hidden" name="destinationId" value={destination.id} />
            <p>
              {routeCount > 0
                ? `This also deletes the ${plural(routeCount, "route", "routes")} going there.`
                : "No routes go there."}
            </p>
            <div>
              <SubmitButton
                variant="danger"
                busy={removing.pending}
                busyLabel="Removing…"
              >
                Remove {destination.label}
              </SubmitButton>
            </div>
            <FormStatus result={removing.result} />
          </form>
        </details>
      </div>
    </li>
  );
}

export default function Destinations({
  destinations,
  routes,
}: {
  destinations: PublicDestination[];
  routes: Route[];
}) {
  const adding = useFormAction(addRedditAction, { resetOnSuccess: true });
  const { heading, message, report } = useSectionStatus();
  const subredditId = useId();
  const hintId = useId();
  return (
    <section
      id="destinations"
      aria-labelledby="destinations-title"
      className={ui.section}
    >
      <h2
        id="destinations-title"
        ref={heading}
        tabIndex={-1}
        className={ui.heading}
      >
        Destinations
      </h2>
      <SectionStatus message={message} />
      {destinations.length > 0 && (
        <ul className={styles.list}>
          {destinations.map((d) => (
            <DestinationRow
              key={d.id}
              destination={d}
              routeCount={routes.filter((r) => r.destinationId === d.id).length}
              onRemoved={() => report("Destination removed.")}
            />
          ))}
        </ul>
      )}
      <div className={styles.add}>
        <div>
          <a href="/api/discord/connect" className={ui.button}>
            Connect a Discord channel
          </a>
        </div>
        <form onSubmit={adding.onSubmit} className={ui.field}>
          <label htmlFor={subredditId} className={ui.label}>
            Add a subreddit
          </label>
          <div className={styles.inline}>
            <input
              id={subredditId}
              name="subreddit"
              className={ui.input}
              placeholder="r/SideProject"
              autoComplete="off"
              aria-describedby={hintId}
            />
            <SubmitButton busy={adding.pending} busyLabel="Adding…">
              Add
            </SubmitButton>
          </div>
          <p id={hintId} className={ui.hint}>
            Ferry prepares each post as a draft, and you post it to Reddit
            yourself in one tap.
          </p>
          <FormStatus result={adding.result} />
        </form>
      </div>
    </section>
  );
}
