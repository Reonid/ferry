"use client";

import { useRouter } from "next/navigation";
import {
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  useState,
  useTransition,
} from "react";
import { TELEGRAM_LINK_TTL_S } from "@/lib/constants";
import type { PublicDestination } from "@/lib/types";
import { PlaneIcon } from "@/app/components/icons";
import ui from "@/app/components/ui.module.css";
import { startTelegramLinkAction } from "./actions";
import { cx } from "./FormParts";
import styles from "./TelegramConnect.module.css";

/** How often an open panel asks whether Telegram has seen its code at first, */
const CHECK_EVERY_MS = 3_000;
/** for how long after the code is shown, */
const CHECK_OFTEN_FOR_MS = 3 * 60_000;
/** and how often after that. */
const CHECK_LATER_EVERY_MS = 15_000;
/** Past this age the server has dropped the code, with a minute to spare. */
const CODE_GONE_AFTER_MS = (TELEGRAM_LINK_TTL_S + 60) * 1000;

type Started = Extract<
  Awaited<ReturnType<typeof startTelegramLinkAction>>,
  { ok: true }
>;

interface CheckAnswer {
  status: "waiting" | "connected" | "expired";
  destination?: PublicDestination;
}

/** Why a panel closed without connecting. */
const STOPPED = {
  expired: "That code expired. Get a new one.",
  signedOut: "Sign in again to connect Telegram.",
  unavailable: "Telegram isn't set up on this Ferry.",
} as const;

type Stop = keyof typeof STOPPED;

interface Message {
  id: number;
  text: string;
  problem: boolean;
}

function NewTab() {
  return <span className="visually-hidden"> (opens in a new tab)</span>;
}

/**
 * Connects a Telegram chat with a one-time code. "chat" shows the code and
 * links that add Ferry's bot to a channel or a group; "dm" shows a link that
 * opens a DM with the bot, then the code to send the bot by hand where the
 * link can't open Telegram (no app, or an embedded browser). While the panel
 * is open it asks the server whether Telegram has seen the code. The bot
 * token stays on the server: the links and the bot's @name come back from
 * the action.
 */
export default function TelegramConnect({
  purpose,
  onConnected,
}: {
  purpose: "chat" | "dm";
  /** Runs once a chat connects, to move focus somewhere that stays. */
  onConnected: () => void;
}) {
  const router = useRouter();
  const [link, setLink] = useState<Started | null>(null);
  const [message, setMessage] = useState<Message | null>(null);
  const [starting, startTransition] = useTransition();
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const codeId = useId();
  const howId = useId();

  function say(text: string, problem = false) {
    setMessage((last) => ({ id: (last?.id ?? 0) + 1, text, problem }));
  }

  // Each press starts over with a new code.
  function start() {
    if (starting) return;
    startTransition(async () => {
      const result = await startTelegramLinkAction(purpose).catch(() => null);
      startTransition(() => {
        if (!result?.ok) {
          setLink(null);
          say(result?.error ?? "Couldn't get a code. Try again.", true);
          return;
        }
        setLink(result);
        // A DM waits on Start in Telegram, or on the code sent by hand.
        say(
          purpose === "dm" ? "Waiting for Telegram…" : "Waiting for the code…",
        );
      });
    });
  }

  async function copy(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      say("Copied.");
    } catch {
      field.current?.focus();
      field.current?.select();
      say(
        "Couldn't copy the code. It's selected, so you can copy it yourself.",
        true,
      );
    }
  }

  const connected = useEffectEvent((destination?: PublicDestination) => {
    setLink(null);
    say(`Connected to ${destination?.label ?? "Telegram"}.`);
    // A fresh server snapshot wins over older polls, so the chat shows now.
    router.refresh();
    onConnected();
  });

  const stopped = useEffectEvent((why: Stop) => {
    // Focus in the closing panel would fall to the page: keep it here.
    if (panel.current?.contains(document.activeElement))
      button.current?.focus();
    setLink(null);
    say(STOPPED[why], true);
  });

  // Asks one request at a time, often at first and then less often, until
  // the server answers for the code, or the panel closes or gets a new code.
  // Only the server's answers end it, so a check that comes due late, as on
  // a phone back from Telegram, still runs and counts.
  const code = link?.code ?? null;
  useEffect(() => {
    if (code === null) return;
    const shownAt = Date.now();
    const request = new AbortController();
    let timer: number | undefined;

    /** One question to the server: its answer, a status that ends it, or nothing. */
    async function ask(): Promise<CheckAnswer | 401 | 404 | null> {
      try {
        const res = await fetch("/api/telegram/check", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ code }),
          signal: request.signal,
        });
        if (res.status === 401 || res.status === 404) return res.status;
        return res.ok ? ((await res.json()) as CheckAnswer) : null;
      } catch {
        return null; // Offline, or the panel closed.
      }
    }

    async function check() {
      const answer = await ask();
      // The panel closed, or moved on to a new code, while this one was out.
      if (request.signal.aborted) return;
      if (answer === 401) return stopped("signedOut");
      if (answer === 404) return stopped("unavailable");
      if (answer?.status === "connected") return connected(answer.destination);
      if (answer?.status === "expired") return stopped("expired");
      const age = Date.now() - shownAt;
      // A safety cap, in case the server never says the code expired.
      if (age > CODE_GONE_AFTER_MS) return stopped("expired");
      timer = window.setTimeout(
        check,
        age < CHECK_OFTEN_FOR_MS ? CHECK_EVERY_MS : CHECK_LATER_EVERY_MS,
      );
    }

    timer = window.setTimeout(check, CHECK_EVERY_MS);
    return () => {
      request.abort();
      window.clearTimeout(timer);
    };
  }, [code]);

  const codeField = link && (
    <div className={ui.field}>
      <label htmlFor={codeId} className={ui.label}>
        Your code
      </label>
      <div className={styles.code}>
        <input
          ref={field}
          id={codeId}
          className={cx(ui.input, styles.value)}
          value={link.code}
          readOnly
          aria-describedby={howId}
        />
        <button
          type="button"
          className={ui.button}
          onClick={() => copy(link.code)}
        >
          Copy<span className="visually-hidden"> code</span>
        </button>
      </div>
    </div>
  );

  return (
    <div className={styles.connect}>
      <div>
        <button
          ref={button}
          type="button"
          className={ui.button}
          aria-disabled={starting || undefined}
          onClick={start}
        >
          <PlaneIcon className={styles.icon} />
          {starting
            ? "Getting a code…"
            : purpose === "chat"
              ? "Connect Telegram"
              : "Get alerts in a Telegram DM"}
        </button>
      </div>
      {link && (
        <div ref={panel} className={styles.panel}>
          {purpose === "chat" ? (
            <>
              {codeField}
              <p id={howId} className={ui.hint}>
                For a channel, post this code there once Ferry is an admin.
                Ferry asks to delete messages only so it can remove the code
                post. For a group, Ferry connects as soon as you add it.
              </p>
              <div className={styles.links}>
                <a
                  href={link.links.channel}
                  target="_blank"
                  rel="noreferrer"
                  className={ui.button}
                >
                  Add Ferry to a channel
                  <NewTab />
                </a>
                <a
                  href={link.links.group}
                  target="_blank"
                  rel="noreferrer"
                  className={ui.button}
                >
                  Add Ferry to a group
                  <NewTab />
                </a>
              </div>
            </>
          ) : (
            <>
              <div>
                <a
                  href={link.links.dm}
                  target="_blank"
                  rel="noreferrer"
                  className={cx(ui.button, ui.primary)}
                >
                  Open Ferry in Telegram
                  <NewTab />
                </a>
              </div>
              <p className={ui.hint}>
                Press Start in Telegram, and Ferry connects.
              </p>
              {codeField}
              <p id={howId} className={ui.hint}>
                Telegram didn&apos;t open? In any Telegram app, find {link.bot},
                press Start, then send this code.
              </p>
            </>
          )}
        </div>
      )}
      <p
        role="status"
        aria-live="polite"
        className={cx(ui.status, message?.problem && ui.error)}
        data-telegram-status=""
      >
        {/* A new span per message, so the same words twice are read twice. */}
        {message && <span key={message.id}>{message.text}</span>}
      </p>
    </div>
  );
}
