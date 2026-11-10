"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  ActivityEntry,
  Channel,
  PublicDestination,
  Route,
} from "@/lib/types";
import CrossingMap from "@/app/(app)/app/CrossingMap";
import { ReplayIcon } from "./icons";

/*
 * The landing's illustration: the dashboard's own crossing map, drawn from
 * made-up placeholders ("Your LinkedIn", "@yourchannel", "r/yoursubreddit")
 * so it can't be read as anyone's real data.
 */

function channel(id: string, service: Channel["service"], name: string) {
  return {
    id,
    organizationId: "example",
    service,
    name,
    displayName: name,
    avatar: "",
    isDisconnected: false,
    isQueuePaused: false,
    isLocked: false,
  } satisfies Channel;
}

function route(id: string, channelIds: string[], destinationId: string) {
  return {
    id,
    accountId: "example",
    channelIds,
    tagNames: [],
    destinationId,
    activeSince: 0,
    paused: false,
    createdAt: 0,
  } satisfies Route;
}

const CHANNELS: Channel[] = [
  channel("example-linkedin", "linkedin", "Your LinkedIn"),
  channel("example-bluesky", "bluesky", "Your Bluesky"),
];

// Telegram heads the far shore so LinkedIn's two lanes fan out above
// Bluesky's instead of crossing them.
const DESTINATIONS: PublicDestination[] = [
  {
    id: "example-telegram",
    kind: "telegram",
    label: "@yourchannel",
    status: "active",
    chatType: "channel",
  },
  {
    id: "example-discord",
    kind: "discord",
    label: "#announcements",
    status: "active",
  },
  {
    id: "example-reddit",
    kind: "reddit",
    label: "r/yoursubreddit",
    status: "active",
  },
];

// In this order the lanes bow apart instead of crossing: the map bows its
// first lane up, the second down, and so on. Lanes that share a port bow
// away from each other, or the same way.
const ROUTES: Route[] = [
  route("example-linkedin-telegram", ["example-linkedin"], "example-telegram"),
  route("example-bluesky-reddit", ["example-bluesky"], "example-reddit"),
  route("example-linkedin-discord", ["example-linkedin"], "example-discord"),
  route("example-bluesky-discord", ["example-bluesky"], "example-discord"),
];

/** Two posts land, each in two places. */
const ARRIVALS: ActivityEntry[] = [
  {
    groupKey: "example-linkedin-post",
    excerpt: "",
    source: { service: "linkedin", name: "Your LinkedIn" },
    publishedAt: 0,
    deliveries: [
      { destinationId: "example-discord", status: "delivered", at: 0 },
      { destinationId: "example-telegram", status: "delivered", at: 0 },
    ],
  },
  {
    groupKey: "example-bluesky-post",
    excerpt: "",
    source: { service: "bluesky", name: "Your Bluesky" },
    publishedAt: 0,
    deliveries: [
      { destinationId: "example-discord", status: "delivered", at: 0 },
      { destinationId: "example-reddit", status: "draft_ready", at: 0 },
    ],
  },
];

const NOTHING_YET: ActivityEntry[] = [];

const LABEL =
  "Example crossing map: posts from LinkedIn and Bluesky cross to #announcements on Discord, LinkedIn posts also cross to @yourchannel on Telegram, and Bluesky posts also become drafts for r/yoursubreddit.";

/** A beat after the map comes into view, so the eye is there first. */
const SETTLE_MS = 500;
/** Long enough for the map to take in the empty sea before boats return. */
const CLEAR_MS = 80;
/** Four staggered boats, sailing and lingering: see crossing.ts. */
const VOYAGE_MS = 5_200;

/**
 * The example map, in its frame, with a Replay button. It sails once when
 * it comes into view; Replay sails it again on request. Under reduced
 * motion it starts still, and Replay lights the lanes instead.
 */
export default function ExampleCrossing({
  className,
  barClassName,
  titleClassName,
  replayClassName,
  mapClassName,
  title = "Crossing map",
  children,
}: {
  className?: string;
  barClassName?: string;
  titleClassName?: string;
  replayClassName?: string;
  /** The frame around the map itself. */
  mapClassName?: string;
  /** The bar's title, as the window around the map names it. */
  title?: ReactNode;
  /** More of the window under the map, such as the latest deliveries. */
  children?: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [activity, setActivity] = useState(NOTHING_YET);
  const [sailing, setSailing] = useState(false);
  const timers = useRef<number[]>([]);

  // The map sends boats for deliveries it hasn't seen, so clearing the sea
  // and handing it the arrivals again sails them again.
  const sail = useCallback(() => {
    const later = (ms: number, run: () => void) =>
      timers.current.push(window.setTimeout(run, ms));
    setSailing(true);
    setActivity(NOTHING_YET);
    later(CLEAR_MS, () => setActivity(ARRIVALS));
    later(CLEAR_MS + VOYAGE_MS, () => setSailing(false));
  }, []);

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const id of pending) window.clearTimeout(id);
    };
  }, []);

  // The first sailing waits until the map is in view. Under reduced motion
  // it stays a still picture.
  useEffect(() => {
    const el = box.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches)
      return;
    let timer: number | undefined;
    const watch = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        watch.disconnect();
        timer = window.setTimeout(sail, SETTLE_MS);
      },
      { threshold: 0.3 },
    );
    watch.observe(el);
    return () => {
      watch.disconnect();
      window.clearTimeout(timer);
    };
  }, [sail]);

  return (
    <div className={className}>
      <div className={barClassName}>
        <p className={titleClassName}>{title}</p>
        <button
          type="button"
          className={replayClassName}
          aria-disabled={sailing || undefined}
          onClick={() => {
            if (!sailing) sail();
          }}
        >
          <ReplayIcon />
          Replay<span className="visually-hidden"> the example crossing</span>
        </button>
      </div>
      <div ref={box} className={mapClassName}>
        <div>
          <CrossingMap
            channels={CHANNELS}
            destinations={DESTINATIONS}
            routes={ROUTES}
            activity={activity}
            label={LABEL}
          />
        </div>
      </div>
      {children}
    </div>
  );
}
