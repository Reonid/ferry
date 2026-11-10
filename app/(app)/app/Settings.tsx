"use client";

import { useId, useRef } from "react";
import type { ActionResult } from "@/lib/routes/manage";
import type { PublicDestination } from "@/lib/types";
import ui from "@/app/components/ui.module.css";
import {
  deleteMyDataAction,
  refreshChannelsAction,
  setNotifyAction,
} from "./actions";
import { cx, FormStatus, SubmitButton, useFormAction } from "./FormParts";
import TelegramConnect from "./TelegramConnect";
import styles from "./Settings.module.css";

async function saveNotify(
  prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const result = await setNotifyAction(prev, formData);
  return result.ok ? { ok: true, message: "Saved." } : result;
}

/** Two things to set: where alerts go, and the Buffer account itself. */
export default function Settings({
  accountName,
  destinations,
  notifyDestinationId,
  telegramEnabled,
}: {
  accountName: string | null;
  destinations: PublicDestination[];
  notifyDestinationId: string | null;
  telegramEnabled: boolean;
}) {
  const notify = useFormAction(saveNotify);
  const refresh = useFormAction(refreshChannelsAction);
  const heading = useRef<HTMLHeadingElement>(null);
  const selectId = useId();
  const hintId = useId();
  const targets = destinations.filter(
    (d) => d.kind === "discord" || d.kind === "telegram",
  );
  return (
    <section id="settings" aria-labelledby="settings-title" className={ui.card}>
      <h2
        id="settings-title"
        ref={heading}
        tabIndex={-1}
        className={ui.heading}
      >
        Settings
      </h2>
      <div className={styles.grid}>
        <div className={styles.group}>
          <form onSubmit={notify.onSubmit} className={styles.group}>
            <label htmlFor={selectId} className={ui.label}>
              Send alerts to
            </label>
            <div className={styles.inline}>
              <select
                // Linking a DM makes it the target on the server: show that.
                key={notifyDestinationId ?? ""}
                id={selectId}
                name="destinationId"
                className={ui.input}
                defaultValue={notifyDestinationId ?? ""}
                aria-describedby={hintId}
              >
                <option value="">Only this page</option>
                {targets.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.label}
                  </option>
                ))}
              </select>
              <SubmitButton busy={notify.pending}>Save</SubmitButton>
            </div>
            <p id={hintId} className={ui.hint}>
              Ferry posts there when a delivery needs you or a Reddit draft is
              ready, so{" "}
              {telegramEnabled
                ? "a private channel or a Telegram DM works best."
                : "a private Discord channel works best."}
            </p>
            <FormStatus result={notify.result} />
          </form>
          {telegramEnabled && (
            <TelegramConnect
              purpose="dm"
              onConnected={() => heading.current?.focus()}
            />
          )}
        </div>

        <div className={styles.group}>
          <h3 className={ui.label}>Buffer account</h3>
          <p className={ui.hint}>
            Signed in with Buffer{accountName ? ` as ${accountName}` : ""}.
            Ferry can read your Buffer posts. It can&apos;t post, edit or delete
            anything.
          </p>
          <div className={styles.buttons}>
            <form onSubmit={refresh.onSubmit}>
              <SubmitButton busy={refresh.pending} busyLabel="Refreshing…">
                Refresh channels
              </SubmitButton>
            </form>
            <form method="post" action="/api/auth/logout">
              <button type="submit" className={ui.button}>
                Sign out
              </button>
            </form>
          </div>
          <FormStatus result={refresh.result} />
          <p className={ui.hint}>
            Signing out doesn&apos;t stop Ferry. Deleting your data does.
          </p>
          <details className={styles.delete}>
            <summary
              className={cx(ui.button, ui.ghost, ui.danger, ui.disclosure)}
            >
              Delete my data
            </summary>
            <div className={styles.confirm}>
              <p>
                This deletes your routes, destinations, activity and drafts from
                Ferry, and signs you out. Nothing changes in Buffer.
              </p>
              <form action={deleteMyDataAction}>
                <button type="submit" className={cx(ui.button, ui.danger)}>
                  Yes, delete my data
                </button>
              </form>
            </div>
          </details>
        </div>
      </div>
    </section>
  );
}
