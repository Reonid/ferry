import { describe, expect, it } from "vitest";
import type {
  ActivityEntry,
  Channel,
  PublicDestination,
  Route,
} from "../types";
import {
  announcements,
  deliveryHref,
  excerptText,
  mapLabel,
  newLandings,
  relativeTime,
  routable,
  routeLabel,
  STATUS_LABEL,
} from "./view";

const MIN = 60_000;
const HOUR = 60 * MIN;
const NOW = 1_800_000_000_000;

function channel(id: string, service: Channel["service"], name: string) {
  return {
    id,
    organizationId: "org",
    service,
    name,
    displayName: name,
    avatar: "",
    isDisconnected: false,
    isQueuePaused: false,
    isLocked: false,
  } satisfies Channel;
}

const channels: Channel[] = [
  channel("bsky", "bluesky", "Ferry Dev"),
  channel("li", "linkedin", "Leon Dev"),
];
const destinations: PublicDestination[] = [
  { id: "disc", kind: "discord", label: "#announcements", status: "active" },
  { id: "red", kind: "reddit", label: "r/SideProject", status: "active" },
];
const route: Route = {
  id: "r1",
  accountId: "a",
  channelIds: ["bsky", "li"],
  tagNames: [],
  destinationId: "disc",
  activeSince: 0,
  paused: false,
  createdAt: 0,
};

function entry(
  groupKey: string,
  deliveries: ActivityEntry["deliveries"],
): ActivityEntry {
  return {
    groupKey,
    excerpt: "We just opened the beta.",
    source: { service: "bluesky", name: "Ferry Dev" },
    publishedAt: NOW - HOUR,
    deliveries,
  };
}

describe("STATUS_LABEL", () => {
  it("uses the plain words from the brief", () => {
    expect(STATUS_LABEL).toEqual({
      pending: "Sending",
      delivered: "Delivered",
      draft_ready: "Draft ready",
      failed: "Needs you",
    });
  });
});

describe("relativeTime", () => {
  it("reads naturally in both directions", () => {
    expect(relativeTime(NOW, NOW)).toBe("now");
    expect(relativeTime(NOW + 30_000, NOW)).toBe("in under a minute");
    expect(relativeTime(NOW + 3 * MIN, NOW)).toBe("in 3 minutes");
    expect(relativeTime(NOW - 20_000, NOW)).toBe("just now");
    expect(relativeTime(NOW - 5 * HOUR, NOW)).toBe("5 hours ago");
    expect(relativeTime(NOW + 26 * HOUR, NOW)).toBe("tomorrow");
  });
});

describe("routeLabel", () => {
  it("names channels by network, then the destination", () => {
    expect(routeLabel(route, channels, destinations)).toBe(
      "Bluesky, LinkedIn → #announcements",
    );
  });

  it("adds the channel name when one network has several channels", () => {
    const two = [...channels, channel("li2", "linkedin", "Ferry Co")];
    expect(
      routeLabel({ ...route, channelIds: ["li", "li2"] }, two, destinations),
    ).toBe("LinkedIn (Leon Dev), LinkedIn (Ferry Co) → #announcements");
  });

  it("says so when a channel is gone from Buffer", () => {
    expect(
      routeLabel({ ...route, channelIds: ["gone"] }, channels, destinations),
    ).toBe("Removed channel → #announcements");
  });
});

describe("routable", () => {
  it("takes chats and subreddits, and leaves Telegram DMs to alerts", () => {
    const telegram = (
      chatType: PublicDestination["chatType"],
    ): PublicDestination => ({
      id: `tg-${chatType}`,
      kind: "telegram",
      label: "Ferry Updates",
      status: "active",
      chatType,
    });
    expect(
      [
        ...destinations,
        telegram("channel"),
        telegram("group"),
        telegram("supergroup"),
        telegram("private"),
      ].map(routable),
    ).toEqual([true, true, true, true, true, false]);
  });
});

describe("mapLabel", () => {
  it("lists every route in words", () => {
    expect(mapLabel([route], channels, destinations)).toBe(
      "Crossing map with 1 route: Bluesky, LinkedIn to #announcements.",
    );
    const paused = { ...route, id: "r2", destinationId: "red", paused: true };
    expect(mapLabel([route, paused], channels, destinations)).toBe(
      "Crossing map with 2 routes: Bluesky, LinkedIn to #announcements; Bluesky, LinkedIn to r/SideProject (paused).",
    );
  });

  it("describes an empty map", () => {
    expect(mapLabel([], channels, destinations)).toBe(
      "Crossing map with no routes yet.",
    );
  });
});

describe("newLandings", () => {
  const delivered = entry("g1", [
    { destinationId: "disc", status: "delivered", at: NOW },
  ]);

  it("finds deliveries that arrived since the last snapshot", () => {
    const before = entry("g1", [
      { destinationId: "disc", status: "pending", at: NOW - MIN },
    ]);
    expect(newLandings([before], [delivered], channels)).toEqual([
      { key: "g1|disc", channelId: "bsky", destinationId: "disc" },
    ]);
  });

  it("counts a ready Reddit draft as a landing", () => {
    const draft = entry("g2", [
      { destinationId: "red", status: "draft_ready", at: NOW },
    ]);
    expect(newLandings([], [draft], channels)).toEqual([
      { key: "g2|red", channelId: "bsky", destinationId: "red" },
    ]);
  });

  it("ignores the first snapshot, repeats, and deliveries still on the way", () => {
    const pending = entry("g3", [
      { destinationId: "disc", status: "pending", at: NOW },
    ]);
    expect(newLandings(null, [delivered], channels)).toEqual([]);
    expect(newLandings([delivered], [delivered], channels)).toEqual([]);
    expect(newLandings([], [pending], channels)).toEqual([]);
  });

  it("leaves the channel empty when the source no longer matches one", () => {
    const stranger = {
      ...delivered,
      source: { service: "threads" as const, name: "Elsewhere" },
    };
    expect(newLandings([], [stranger], channels)).toEqual([
      { key: "g1|disc", channelId: null, destinationId: "disc" },
    ]);
  });
});

describe("announcements", () => {
  it("announces new entries and status changes, not the first load", () => {
    const sending = entry("g1", [
      { destinationId: "disc", status: "pending", at: NOW },
    ]);
    const done = entry("g1", [
      { destinationId: "disc", status: "delivered", at: NOW },
      { destinationId: "red", status: "draft_ready", at: NOW },
    ]);
    expect(announcements(null, [sending], destinations)).toEqual([]);
    expect(announcements([], [sending], destinations)).toEqual([
      "Sending to #announcements: “We just opened the beta.”",
    ]);
    expect(announcements([sending], [done], destinations)).toEqual([
      "Delivered to #announcements: “We just opened the beta.”",
      "Draft ready for r/SideProject: “We just opened the beta.”",
    ]);
    expect(announcements([done], [done], destinations)).toEqual([]);
  });

  it("asks for help when a delivery fails", () => {
    const failed = entry("g1", [
      { destinationId: "disc", status: "failed", at: NOW, jobId: "j" },
    ]);
    expect(announcements([], [failed], destinations)).toEqual([
      "Needs you: #announcements didn't get “We just opened the beta.”",
    ]);
  });
});

describe("deliveryHref", () => {
  it("links drafts to their page on this site", () => {
    expect(
      deliveryHref({
        destinationId: "red",
        status: "draft_ready",
        at: NOW,
        url: "https://ferry.example/d/abc123",
      }),
    ).toBe("/d/abc123");
  });

  it("links delivered posts to Discord over https only", () => {
    const base = {
      destinationId: "disc",
      status: "delivered" as const,
      at: NOW,
    };
    expect(
      deliveryHref({ ...base, url: "https://discord.com/channels/1/2/3" }),
    ).toBe("https://discord.com/channels/1/2/3");
    expect(deliveryHref({ ...base, url: "javascript:alert(1)" })).toBeNull();
    expect(deliveryHref(base)).toBeNull();
  });
});

describe("excerptText", () => {
  it("marks excerpts that were cut short", () => {
    expect(excerptText("Short post.")).toBe("Short post.");
    expect(excerptText("x".repeat(80))).toBe(`${"x".repeat(80)}…`);
  });
});
