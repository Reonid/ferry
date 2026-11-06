"use client";

import {
  startTransition,
  useActionState,
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
 */
export function useFormAction(
  action: ServerAction,
  { resetOnSuccess = false }: { resetOnSuccess?: boolean } = {},
) {
  const [intent, setIntent] = useState<string | null>(null);
  const [result, dispatch, pending] = useActionState(
    async (prev: ActionResult | null, { formData, form }: Submission) => {
      const next = await action(prev, formData);
      if (next.ok && resetOnSuccess) form.reset();
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
