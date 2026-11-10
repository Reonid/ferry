"use client";

import { useId } from "react";
import { relativeTime } from "@/lib/dashboard/view";
import type { Connection } from "@/lib/oauth/connections";
import type { ActionResult } from "@/lib/routes/manage";
import type { PublicDestination } from "@/lib/types";
import CopyField from "@/app/components/CopyField";
import ui from "@/app/components/ui.module.css";
import {
  deleteMyDataAction,
  disconnectAssistantAction,
  refreshChannelsAction,
  setNotifyAction,
} from "./actions";
import {
  cx,
  FormStatus,
  SectionStatus,
  SubmitButton,
  useFormAction,
  useSectionStatus,
} from "./FormParts";
import TelegramConnect from "./TelegramConnect";
import styles from "./Settings.module.css";

async function saveNotify(
  prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const result = await setNotifyAction(prev, formData);
  return result.ok ? { ok: true, message: "Saved." } : result;
}

/** One connected AI app, with the button that ends its access. */
function AssistantRow({
  assistant,
  now,
  onGone,
}: {
  assistant: Connection;
  now: number;
  onGone: (text: string) => void;
}) {
  // The row leaves with its own status line, so the section reports.
  const ending = useFormAction(disconnectAssistantAction, {
    onResult: (answer) => {
      if (answer.ok) onGone(`${assistant.name} is disconnected.`);
    },
  });
  return (
    <li className={styles.assistant}>
      <span className={styles.who}>
        <span className={styles.app}>{assistant.name}</span>
        <span className={ui.hint}>
          {assistant.host} ·{" "}
          {assistant.canWrite ? "can make changes" : "reads only"} · connected{" "}
          {relativeTime(assistant.connectedAt, now)}
        </span>
      </span>
      <form onSubmit={ending.onSubmit}>
        <input type="hidden" name="connectionId" value={assistant.id} />
        <SubmitButton
          variant="quiet-danger"
          small
          busy={ending.pending}
          busyLabel="Disconnecting…"
        >
          Disconnect<span className="visually-hidden"> {assistant.name}</span>
        </SubmitButton>
      </form>
      <FormStatus result={ending.result?.ok ? null : ending.result} />
    </li>
  );
}

/** Where alerts go, the Buffer account itself, and connected AI apps. */
export default function Settings({
  accountName,
  destinations,
  notifyDestinationId,
  telegramEnabled,
  assistants,
  mcpUrl,
  now,
}: {
  accountName: string | null;
  destinations: PublicDestination[];
  notifyDestinationId: string | null;
  telegramEnabled: boolean;
  assistants: Connection[];
  mcpUrl: string;
  now: number;
}) {
  const notify = useFormAction(saveNotify);
  const refresh = useFormAction(refreshChannelsAction);
  const { heading, message, report } = useSectionStatus();
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
                Ferry, disconnects any AI apps, and signs you out. Nothing
                changes in Buffer.
              </p>
              <form action={deleteMyDataAction}>
                <button type="submit" className={cx(ui.button, ui.danger)}>
                  Yes, delete my data
                </button>
              </form>
            </div>
          </details>
        </div>

        <div className={cx(styles.group, styles.wide)}>
          <h3 className={ui.label}>AI assistants</h3>
          <p className={ui.hint}>
            Ask Claude, ChatGPT or another MCP app what Ferry carried, or to
            polish a Reddit draft. Add a custom connector with this address,
            then sign in with Buffer when it asks. It reads your routes,
            activity, drafts and alerts. Allow changes when it connects, and it
            can also pause, resume, add and test routes and send failed posts
            again. It can&apos;t delete anything.
          </p>
          <div className={styles.address}>
            <CopyField label="Connector address" value={mcpUrl} />
          </div>
          {assistants.length > 0 && (
            <ul className={styles.assistants} aria-label="Connected apps">
              {assistants.map((assistant) => (
                <AssistantRow
                  key={assistant.id}
                  assistant={assistant}
                  now={now}
                  onGone={report}
                />
              ))}
            </ul>
          )}
          <SectionStatus message={message} />
        </div>
      </div>
    </section>
  );
}
