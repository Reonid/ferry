"use client";

import { useId, useState, type ReactNode } from "react";
import { plural, routable } from "@/lib/dashboard/view";
import type { ActionResult } from "@/lib/routes/manage";
import type { PublicDestination, Route } from "@/lib/types";
import ui from "@/app/components/ui.module.css";
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
import { ChatIcon, DraftIcon, PlaneIcon } from "@/app/components/icons";
import TelegramConnect from "./TelegramConnect";
import styles from "./Destinations.module.css";

const KIND_ICON: Record<PublicDestination["kind"], ReactNode> = {
  discord: <ChatIcon />,
  telegram: <PlaneIcon />,
  reddit: <DraftIcon />,
};

const TELEGRAM_KIND: Record<
  NonNullable<PublicDestination["chatType"]>,
  string
> = {
  channel: "Telegram channel",
  group: "Telegram group",
  supergroup: "Telegram group",
  private: "Telegram DM",
};

/** How to fix a broken Telegram chat: connecting it again revives its row. */
const TELEGRAM_BROKEN =
  "Telegram stopped accepting posts here. Connect the chat again with Connect Telegram, then resume its routes.";
/** A basic group upgraded to a supergroup gets a new id, so a new row. */
const TELEGRAM_GROUP_BROKEN =
  "Telegram stopped accepting posts here. Connect the group again with Connect Telegram, then resume its routes. If it comes back as a new row, add the routes there and remove this one.";
/** A Discord webhook can't be revived: a new connect makes a new row. */
const DISCORD_BROKEN =
  "Discord stopped accepting posts here. Connect the channel again, then remove this one.";

/** The line under a destination's name. */
function kindLabel(destination: PublicDestination): string {
  if (destination.kind === "discord") return "Discord channel";
  if (destination.kind === "reddit") return "Reddit drafts";
  return destination.chatType
    ? TELEGRAM_KIND[destination.chatType]
    : "Telegram chat";
}

function brokenText(destination: PublicDestination): string {
  if (destination.kind !== "telegram") return DISCORD_BROKEN;
  return destination.chatType === "group"
    ? TELEGRAM_GROUP_BROKEN
    : TELEGRAM_BROKEN;
}

async function rename(
  prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const result = await renameDestinationAction(prev, formData);
  return result.ok ? { ok: true, message: "Name saved." } : result;
}

/**
 * A destination as one line: what kind of place it is, and its name. The
 * line opens to Rename and Remove. A broken one starts open, with its fix.
 */
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
  const costId = useId();
  const broken = destination.status === "broken";
  return (
    <li className={cx(styles.item, broken && styles.isBroken)}>
      <details open={broken}>
        <summary className={cx(ui.row, styles.summary)}>
          <span className={cx(styles.icon, styles[destination.kind])}>
            {KIND_ICON[destination.kind]}
          </span>
          <span className={styles.what}>
            <span id={nameId} className={styles.name}>
              {destination.label}
            </span>
            <span className={styles.kind}>{kindLabel(destination)}</span>
            {broken && (
              <span className={styles.broken}>{brokenText(destination)}</span>
            )}
          </span>
        </summary>
        <div className={styles.panel}>
          {broken && destination.kind === "discord" && (
            <div>
              <a
                href="/api/discord/connect"
                className={cx(ui.button, ui.small)}
              >
                Connect the channel again
              </a>
            </div>
          )}
          <form onSubmit={renaming.onSubmit} className={ui.field}>
            <input type="hidden" name="destinationId" value={destination.id} />
            <label htmlFor={inputId} className={ui.label}>
              Name
            </label>
            <div className={styles.inline}>
              <input
                id={inputId}
                name="label"
                className={ui.input}
                defaultValue={destination.label}
                maxLength={60}
                autoComplete="off"
              />
              <SubmitButton busy={renaming.pending}>Save name</SubmitButton>
            </div>
            <FormStatus result={renaming.result} />
          </form>
          <form onSubmit={removing.onSubmit} className={styles.remove}>
            <input type="hidden" name="destinationId" value={destination.id} />
            <SubmitButton
              variant="quiet-danger"
              small
              busy={removing.pending}
              busyLabel="Removing…"
              describedBy={routeCount > 0 ? costId : undefined}
            >
              Remove {destination.label}
            </SubmitButton>
            {routeCount > 0 && (
              <p id={costId} className={ui.hint}>
                This also deletes the {plural(routeCount, "route", "routes")}{" "}
                going there.
              </p>
            )}
            <FormStatus result={removing.result} />
          </form>
        </div>
      </details>
    </li>
  );
}

/** The ways to add a place: Discord, Telegram, or a subreddit for drafts. */
function AddDestination({
  telegramEnabled,
  startOpen,
  onTelegramConnected,
}: {
  telegramEnabled: boolean;
  startOpen: boolean;
  onTelegramConnected: () => void;
}) {
  const adding = useFormAction(addRedditAction, { resetOnSuccess: true });
  const subredditId = useId();
  const hintId = useId();
  return (
    <details open={startOpen}>
      <summary className={cx(ui.button, ui.disclosure, ui.adds, ui.adder)}>
        Add a destination
      </summary>
      <div className={styles.add}>
        <div>
          <a href="/api/discord/connect" className={ui.button}>
            <ChatIcon className={styles.buttonIcon} />
            Connect a Discord channel
          </a>
        </div>
        {telegramEnabled && (
          // The new chat's row arrives with the refresh, and focus waits on
          // the heading above it.
          <TelegramConnect purpose="chat" onConnected={onTelegramConnected} />
        )}
        <form onSubmit={adding.onSubmit} className={ui.field}>
          <label htmlFor={subredditId} className={ui.label}>
            Add a subreddit
          </label>
          <div className={styles.inline}>
            <input
              id={subredditId}
              name="subreddit"
              className={ui.input}
              placeholder="r/yoursubreddit"
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
    </details>
  );
}

export default function Destinations({
  destinations,
  routes,
  telegramEnabled,
}: {
  destinations: PublicDestination[];
  routes: Route[];
  telegramEnabled: boolean;
}) {
  const { heading, message, report } = useSectionStatus();
  // With nowhere for posts to go yet, the ways to add one start open.
  const [startOpen] = useState(!destinations.some(routable));
  return (
    <section
      id="destinations"
      aria-labelledby="destinations-title"
      className={ui.card}
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
      <AddDestination
        telegramEnabled={telegramEnabled}
        startOpen={startOpen}
        onTelegramConnected={() => report(null)}
      />
    </section>
  );
}
