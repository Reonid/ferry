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
import type { PublicDestination } from "@/lib/types";
import ui from "../components/ui.module.css";
import { startTelegramLinkAction } from "./actions";
import { cx } from "./FormParts";
import styles from "./TelegramConnect.module.css";

/** How often an open panel asks whether Telegram has seen its code. */
const CHECK_EVERY_MS = 3_000;
/** How long it keeps asking. */
const CHECK_FOR_MS = 3 * 60_000;

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
  missed: "Ferry didn't see the code. Try again.",
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
 * links that add Ferry's bot to a channel or a group; "dm" shows one link
 * that opens a DM with the bot. While the panel is open it asks the server
 * whether Telegram has seen the code. The bot token and username stay on the
 * server: the links come back from the action.
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
        say("Waiting for the code…");
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

  // Asks every few seconds, one request at a time, until an answer ends it,
  // the time runs out, or the panel closes.
  const code = link?.code ?? null;
  useEffect(() => {
    if (code === null) return;
    const request = new AbortController();
    let timer: number | undefined;
    let over = false;
    const deadline = window.setTimeout(
      () => end(() => stopped("missed")),
      CHECK_FOR_MS,
    );

    function end(finish: () => void) {
      if (over) return;
      over = true;
      request.abort();
      window.clearTimeout(timer);
      window.clearTimeout(deadline);
      finish();
    }

    async function check() {
      try {
        const res = await fetch("/api/telegram/check", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ code }),
          signal: request.signal,
        });
        if (res.status === 401) return end(() => stopped("signedOut"));
        if (res.status === 404) return end(() => stopped("unavailable"));
        if (res.ok) {
          const answer = (await res.json()) as CheckAnswer;
          if (answer.status === "connected")
            return end(() => connected(answer.destination));
          if (answer.status === "expired") return end(() => stopped("expired"));
        }
      } catch {
        // Offline, or the panel closed: the next check, if any, tries again.
      }
      if (!over) timer = window.setTimeout(check, CHECK_EVERY_MS);
    }

    timer = window.setTimeout(check, CHECK_EVERY_MS);
    return () => {
      over = true;
      request.abort();
      window.clearTimeout(timer);
      window.clearTimeout(deadline);
    };
  }, [code]);

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
              <p id={howId} className={ui.hint}>
                For a channel, post this code there once Ferry is an admin. For
                a group, Ferry connects as soon as you add it.
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
