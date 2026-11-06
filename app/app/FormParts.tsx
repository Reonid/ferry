"use client";

import {
  startTransition,
  useActionState,
  useCallback,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import type { ActionResult } from "@/lib/routes/manage";
import ui from "../components/ui.module.css";

export type ServerAction = (
  prev: ActionResult | null,
  formData: FormData,
) => Promise<ActionResult>;

export function cx(...names: (string | false | null | undefined)[]): string {
  return names.filter(Boolean).join(" ");
}

interface Submission {
  formData: FormData;
  form: HTMLFormElement;
}

/**
 * Runs a server action from a form and keeps its result. It submits through
 * onSubmit rather than the action prop: React resets a form after any action
 * prop runs, which would wipe what people typed when the action reports an
 * error. `intent` is the value of the button that submitted the form.
 * `onResult` hears every answer, for work beyond the form, such as when
 * the form itself goes away because the action succeeded.
 */
export function useFormAction(
  action: ServerAction,
  {
    resetOnSuccess = false,
    onResult,
  }: {
    resetOnSuccess?: boolean;
    onResult?: (result: ActionResult, formData: FormData) => void;
  } = {},
) {
  const [intent, setIntent] = useState<string | null>(null);
  const [result, dispatch, pending] = useActionState(
    async (prev: ActionResult | null, { formData, form }: Submission) => {
      const next = await action(prev, formData);
      if (next.ok && resetOnSuccess) form.reset();
      onResult?.(next, formData);
      return next;
    },
    null,
  );

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = event.currentTarget;
    const { submitter } = event.nativeEvent as SubmitEvent;
    const formData = new FormData(form, submitter);
    const value = formData.get("intent");
    setIntent(typeof value === "string" ? value : null);
    startTransition(() => dispatch({ formData, form }));
  }

  return { result, pending, intent, onSubmit };
}

export function SubmitButton({
  children,
  busy = false,
  busyLabel,
  intent,
  variant,
  describedBy,
}: {
  children: ReactNode;
  busy?: boolean;
  busyLabel?: string;
  intent?: string;
  variant?: "primary" | "danger";
  describedBy?: string;
}) {
  return (
    <button
      type="submit"
      name={intent ? "intent" : undefined}
      value={intent}
      className={cx(ui.button, variant && ui[variant])}
      aria-disabled={busy || undefined}
      aria-describedby={describedBy}
    >
      {busy && busyLabel ? busyLabel : children}
    </button>
  );
}

export interface SectionMessage {
  id: number;
  text: string;
}

/**
 * For results that outlive the control that caused them. When an action
 * removes its own row, the row's status line and the focused button go with
 * it. `report` puts the message (if any) in the section's status line and
 * moves focus to the section heading, which needs tabIndex={-1}.
 */
export function useSectionStatus() {
  const heading = useRef<HTMLHeadingElement>(null);
  const [message, setMessage] = useState<SectionMessage | null>(null);
  const report = useCallback((text: string | null) => {
    if (text !== null)
      setMessage((last) => ({ id: (last?.id ?? 0) + 1, text }));
    heading.current?.focus();
  }, []);
  return { heading, message, report };
}

/** A section's live line. Always mounted, so it is in place before news. */
export function SectionStatus({ message }: { message: SectionMessage | null }) {
  return (
    <p role="status" className={ui.status} data-section-status="">
      {/* A new span per message, so the same words twice are read twice. */}
      {message && <span key={message.id}>{message.text}</span>}
    </p>
  );
}

/** The live line under a form: the action's message, or its error. */
export function FormStatus({
  result,
  className,
}: {
  result: ActionResult | null;
  className?: string;
}) {
  const text =
    result === null ? "" : result.ok ? (result.message ?? "") : result.error;
  return (
    <p
      role="status"
      className={cx(ui.status, result?.ok === false && ui.error, className)}
    >
      {text}
    </p>
  );
}
