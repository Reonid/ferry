import { EXCERPT_CHARS } from "../constants";
import { serviceLabel } from "../mirror/services";
import type {
  ActivityEntry,
  Channel,
  DeliveryStatus,
  PublicDestination,
  Route,
} from "../types";

/** Pure helpers that turn the dashboard snapshot into words. */

type Delivery = ActivityEntry["deliveries"][number];

export const STATUS_LABEL: Record<DeliveryStatus, string> = {
  pending: "Sending",
  delivered: "Delivered",
  draft_ready: "Draft ready",
  failed: "Needs you",
};

/**
 * Whether Ferry is checking Buffer for this account: it is when a route is
 * running and Buffer still lets it in.
 */
export type SyncMode = "live" | "paused" | "empty" | "reauth";

export function syncMode(
  routes: Route[],
  accountStatus: "active" | "needs_reauth",
): SyncMode {
  if (accountStatus === "needs_reauth") return "reauth";
  if (routes.length === 0) return "empty";
  return routes.some((r) => !r.paused) ? "live" : "paused";
}

export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

/** "in 3 minutes", "now", "5 hours ago": coarse on purpose, for people. */
export function relativeTime(at: number, now: number): string {
  const diff = at - now;
  const abs = Math.abs(diff);
  if (abs < MINUTE) {
    if (diff < 0) return "just now";
    return diff < 1000 ? "now" : "in under a minute";
  }
  const sign = Math.sign(diff);
  const minutes = Math.round(abs / MINUTE);
  if (minutes < 60) return relative.format(sign * minutes, "minute");
  const hours = Math.round(abs / HOUR);
  if (hours < 24) return relative.format(sign * hours, "hour");
  return relative.format(sign * Math.round(abs / DAY), "day");
}

export function channelName(channel: Channel): string {
  return channel.displayName ?? channel.name;
}

/** Network names, with the channel name added where one network has several. */
function networkNames(channels: Channel[]): Map<string, string> {
  const counts = new Map<string, number>();
  for (const c of channels)
    counts.set(c.service, (counts.get(c.service) ?? 0) + 1);
  return new Map(
    channels.map((c) => [
      c.id,
      (counts.get(c.service) ?? 0) > 1
        ? `${serviceLabel(c.service)} (${channelName(c)})`
        : serviceLabel(c.service),
    ]),
  );
}

/** Whether a route can go there. A Telegram DM takes only alerts and draft notices. */
export function routable(destination: PublicDestination): boolean {
  return !(
    destination.kind === "telegram" && destination.chatType === "private"
  );
}

export function destinationName(
  id: string,
  destinations: PublicDestination[],
): string {
  return destinations.find((d) => d.id === id)?.label ?? "Removed destination";
}

function routeParts(
  route: Route,
  channels: Channel[],
  destinations: PublicDestination[],
): { from: string; to: string } {
  const names = networkNames(channels);
  const from = channels
    .filter((c) => route.channelIds.includes(c.id))
    .map((c) => names.get(c.id) ?? serviceLabel(c.service));
  const missing = route.channelIds.filter((id) => !names.has(id)).length;
  if (missing === 1) from.push("Removed channel");
  if (missing > 1) from.push(`${missing} removed channels`);
  return {
    from: from.join(", "),
    to: destinationName(route.destinationId, destinations),
  };
}

/** "LinkedIn, Bluesky → #announcements" */
export function routeLabel(
  route: Route,
  channels: Channel[],
  destinations: PublicDestination[],
): string {
  const { from, to } = routeParts(route, channels, destinations);
  return `${from} → ${to}`;
}

/** The crossing map's accessible name: every route, in words. */
export function mapLabel(
  routes: Route[],
  channels: Channel[],
  destinations: PublicDestination[],
): string {
  if (routes.length === 0) return "Crossing map with no routes yet.";
  const parts = routes.map((route) => {
    const { from, to } = routeParts(route, channels, destinations);
    return `${from} to ${to}${route.paused ? " (paused)" : ""}`;
  });
  return `Crossing map with ${plural(routes.length, "route", "routes")}: ${parts.join("; ")}.`;
}

const LANDED: ReadonlySet<DeliveryStatus> = new Set([
  "delivered",
  "draft_ready",
]);

export interface Landing {
  /** Post group and destination: "groupKey|destinationId". */
  key: string;
  channelId: string | null;
  destinationId: string;
}

const deliveryKey = (entry: ActivityEntry, delivery: Delivery) =>
  `${entry.groupKey}|${delivery.destinationId}`;

export function sourceChannelId(
  entry: ActivityEntry,
  channels: Channel[],
): string | null {
  return (
    channels.find(
      (c) =>
        c.service === entry.source.service &&
        channelName(c) === entry.source.name,
    )?.id ?? null
  );
}

/** Deliveries that arrived since `prev`. The first snapshot has none. */
export function newLandings(
  prev: ActivityEntry[] | null,
  next: ActivityEntry[],
  channels: Channel[],
): Landing[] {
  if (prev === null) return [];
  const before = new Set<string>();
  for (const entry of prev)
    for (const d of entry.deliveries)
      if (LANDED.has(d.status)) before.add(deliveryKey(entry, d));
  const out: Landing[] = [];
  for (const entry of next)
    for (const d of entry.deliveries) {
      const key = deliveryKey(entry, d);
      if (LANDED.has(d.status) && !before.has(key))
        out.push({
          key,
          channelId: sourceChannelId(entry, channels),
          destinationId: d.destinationId,
        });
    }
  return out;
}

const PHRASE: Record<DeliveryStatus, (dest: string, quote: string) => string> =
  {
    pending: (dest, quote) => `Sending to ${dest}: ${quote}`,
    delivered: (dest, quote) => `Delivered to ${dest}: ${quote}`,
    draft_ready: (dest, quote) => `Draft ready for ${dest}: ${quote}`,
    failed: (dest, quote) => `Needs you: ${dest} didn't get ${quote}`,
  };

/** Sentences for the activity live region: new entries and status changes. */
export function announcements(
  prev: ActivityEntry[] | null,
  next: ActivityEntry[],
  destinations: PublicDestination[],
): string[] {
  if (prev === null) return [];
  const before = new Map<string, DeliveryStatus>();
  for (const entry of prev)
    for (const d of entry.deliveries)
      before.set(deliveryKey(entry, d), d.status);
  const out: string[] = [];
  for (const entry of next)
    for (const d of entry.deliveries) {
      if (before.get(deliveryKey(entry, d)) === d.status) continue;
      out.push(
        PHRASE[d.status](
          destinationName(d.destinationId, destinations),
          `“${excerptText(entry.excerpt)}”`,
        ),
      );
    }
  return out;
}

/** Where a status links: the draft page, or the Discord message (https only). */
export function deliveryHref(delivery: Delivery): string | null {
  const { url, status } = delivery;
  if (!url) return null;
  if (status === "delivered") return /^https:\/\//i.test(url) ? url : null;
  if (status !== "draft_ready") return null;
  try {
    const { pathname } = new URL(url, "https://ferry.invalid");
    return /^\/d\/[\w-]+$/.test(pathname) ? pathname : null;
  } catch {
    return null;
  }
}

/** Excerpts are stored cut at EXCERPT_CHARS; mark the ones that were cut. */
export function excerptText(excerpt: string): string {
  return Array.from(excerpt).length >= EXCERPT_CHARS ? `${excerpt}…` : excerpt;
}
