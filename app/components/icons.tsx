import type { ReactNode } from "react";

/*
 * Ferry's few icons, drawn on a 16-unit grid with one stroke weight. Every
 * one is decorative: the text beside it says what it means.
 */

function Icon({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {children}
    </svg>
  );
}

export function ArrowIcon({ className }: { className?: string }) {
  return (
    <Icon className={className}>
      <path d="M3 8h9.5M8.5 4l4 4-4 4" />
    </Icon>
  );
}

/** Leaves for another site, in a new tab. */
export function ExternalIcon({ className }: { className?: string }) {
  return (
    <Icon className={className}>
      <path d="M5 11 11.5 4.5M6.5 4.5h5v5" />
    </Icon>
  );
}

export function LockIcon({ className }: { className?: string }) {
  return (
    <Icon className={className}>
      <rect x="3.25" y="7" width="9.5" height="6.75" rx="1.75" />
      <path d="M5.5 7V5.25a2.5 2.5 0 0 1 5 0V7" />
    </Icon>
  );
}

/** A Discord channel: a message in a thread of them. */
export function ChatIcon({ className }: { className?: string }) {
  return (
    <Icon className={className}>
      <path d="M2.75 4.25a1.5 1.5 0 0 1 1.5-1.5h7.5a1.5 1.5 0 0 1 1.5 1.5v5a1.5 1.5 0 0 1-1.5 1.5H7.5L4.75 13v-2.25h-.5a1.5 1.5 0 0 1-1.5-1.5z" />
      <path d="M5.5 6h5M5.5 8h3" />
    </Icon>
  );
}

/** A Telegram chat: a message sent off. */
export function PlaneIcon({ className }: { className?: string }) {
  return (
    <Icon className={className}>
      <path d="M13.75 2.5 2.25 7.25l4.25 1.5 1.5 4.5 5.75-10.75Z" />
      <path d="m6.5 8.75 7.25-6.25" />
    </Icon>
  );
}

/** A Reddit draft: a page waiting for a person. */
export function DraftIcon({ className }: { className?: string }) {
  return (
    <Icon className={className}>
      <path d="M4 2.75h5.25L12 5.5v7.75H4z" />
      <path d="M9 2.75V5.75h3M6 8.5h4M6 10.75h2.5" />
    </Icon>
  );
}

export function CheckIcon({ className }: { className?: string }) {
  return (
    <Icon className={className}>
      <path d="m3.5 8.5 3 3 6-7" />
    </Icon>
  );
}

export function ReplayIcon({ className }: { className?: string }) {
  return (
    <Icon className={className}>
      <path d="M3.5 8a4.5 4.5 0 1 0 1.4-3.25" />
      <path d="M3 2.5v3h3" />
    </Icon>
  );
}
