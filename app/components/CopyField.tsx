"use client";

import { useId, useRef, useState, useSyncExternalStore } from "react";
import ui from "@/app/components/ui.module.css";
import styles from "./CopyField.module.css";

const noChanges = () => () => {};

/** False on the server and while hydrating; true once React runs here. */
function useHydrated(): boolean {
  return useSyncExternalStore(
    noChanges,
    () => true,
    () => false,
  );
}

interface Message {
  id: number;
  text: string;
}

/** Characters per line on a phone, to size the field where CSS can't. */
const PHONE_LINE = 38;

function rowsFor(value: string): number {
  const lines = value
    .split("\n")
    .reduce(
      (n, line) => n + Math.max(1, Math.ceil(line.length / PHONE_LINE)),
      0,
    );
  return Math.min(12, lines);
}

/**
 * A read-only draft field with a Copy button. The result is read out from
 * a status line that is always mounted. If the clipboard refuses, the text
 * is selected instead, so it can be copied by hand.
 */
export default function CopyField({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  const id = useId();
  const field = useRef<HTMLTextAreaElement>(null);
  const [message, setMessage] = useState<Message | null>(null);
  // The button needs JavaScript; until then it's disabled, not inert.
  const hydrated = useHydrated();
  const name = label.toLowerCase();

  async function copy() {
    let text = `${label} copied.`;
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      field.current?.focus();
      field.current?.select();
      text = `Couldn't copy the ${name}. It's selected, so you can copy it yourself.`;
    }
    setMessage((last) => ({ id: (last?.id ?? 0) + 1, text }));
  }

  return (
    <div className={styles.field}>
      <div className={styles.top}>
        <label htmlFor={id} className={ui.label}>
          {label}
        </label>
        <button
          type="button"
          className={`${ui.button} ${ui.small}`}
          onClick={copy}
          disabled={!hydrated}
        >
          Copy<span className="visually-hidden"> {name}</span>
        </button>
      </div>
      <textarea
        ref={field}
        id={id}
        className={`${ui.input} ${styles.value}`}
        value={value}
        rows={rowsFor(value)}
        readOnly
      />
      <p role="status" className={ui.status}>
        {/* A new span per copy, so the same words twice are read twice. */}
        {message && <span key={message.id}>{message.text}</span>}
      </p>
    </div>
  );
}
