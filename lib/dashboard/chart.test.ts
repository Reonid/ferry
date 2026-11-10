import { describe, expect, it } from "vitest";
import type { Channel, PublicDestination, Route } from "../types";
import { laneKey, layoutChart, NARROW, WIDE } from "./chart";

function channel(id: string, name: string): Channel {
  return {
    id,
    organizationId: "org",
    service: "bluesky",
    name,
    displayName: null,
    avatar: "",
    isDisconnected: false,
    isQueuePaused: false,
    isLocked: false,
  };
}

function route(id: string, channelIds: string[], destinationId: string) {
  return {
    id,
    accountId: "a",
    channelIds,
    tagNames: [],
    destinationId,
    activeSince: 0,
    paused: false,
    createdAt: 0,
  } satisfies Route;
}

const channels = [channel("c1", "Ferry Dev"), channel("c2", "Leon Dev")];
const destinations: PublicDestination[] = [
  { id: "d1", kind: "discord", label: "#announcements", status: "active" },
  { id: "d2", kind: "reddit", label: "r/SideProject", status: "active" },
];

/** First and last points of a lane path "M x y C ... x y". */
function ends(d: string): [number, number, number, number] {
  const n = d.match(/-?\d+(\.\d+)?/g)!.map(Number);
  return [n[0]!, n[1]!, n[n.length - 2]!, n[n.length - 1]!];
}

describe("layoutChart", () => {
  it("draws one lane per channel and destination pair", () => {
    const chart = layoutChart(
      {
        channels,
        destinations,
        routes: [
          route("r1", ["c1", "c2"], "d1"),
          route("r2", ["c1"], "d1"), // same pair as r1: one lane
          route("r3", ["c2"], "d2"),
        ],
      },
      WIDE,
    );
    expect(chart.lanes.map((l) => l.key)).toEqual([
      laneKey("c1", "d1"),
      laneKey("c2", "d1"),
      laneKey("c2", "d2"),
    ]);
  });

  it("starts each lane at its channel and ends it at its destination", () => {
    const chart = layoutChart(
      { channels, destinations, routes: [route("r1", ["c2"], "d2")] },
      WIDE,
    );
    const lane = chart.lanes[0]!;
    const from = chart.left.find((p) => p.id === "c2")!;
    const to = chart.right.find((p) => p.id === "d2")!;
    expect(ends(lane.d)).toEqual([from.x, from.y, to.x, to.y]);
    expect(from.x).toBeLessThan(to.x);
  });

  it("shows every channel and destination, marking the unused ones", () => {
    const chart = layoutChart(
      { channels, destinations, routes: [route("r1", ["c1"], "d1")] },
      NARROW,
    );
    expect(chart.left.map((p) => [p.title, p.active])).toEqual([
      ["Ferry Dev", true],
      ["Leon Dev", false],
    ]);
    expect(chart.right.map((p) => [p.title, p.detail, p.active])).toEqual([
      ["#announcements", "Discord", true],
      ["r/SideProject", "Reddit drafts", false],
    ]);
  });

  it("marks paused routes and broken destinations", () => {
    const broken: PublicDestination[] = [
      { ...destinations[0]!, status: "broken" },
      destinations[1]!,
    ];
    const chart = layoutChart(
      {
        channels,
        destinations: broken,
        routes: [
          route("r1", ["c1"], "d1"),
          { ...route("r2", ["c2"], "d2"), paused: true },
        ],
      },
      WIDE,
    );
    expect(chart.lanes.map((l) => l.state)).toEqual(["broken", "paused"]);
    expect(chart.right[0]!.detail).toBe("Reconnect Discord");
  });

  it("names Telegram ports, and asks to reconnect a broken one", () => {
    const telegram: PublicDestination[] = [
      {
        id: "t1",
        kind: "telegram",
        label: "Ferry Updates",
        status: "active",
        chatType: "channel",
      },
      {
        id: "t2",
        kind: "telegram",
        label: "Ferry Crew",
        status: "broken",
        chatType: "supergroup",
      },
    ];
    const chart = layoutChart(
      { channels, destinations: telegram, routes: [] },
      WIDE,
    );
    expect(chart.right.map((p) => p.detail)).toEqual([
      "Telegram",
      "Reconnect Telegram",
    ]);
  });

  it("skips lanes whose channel or destination is gone", () => {
    const chart = layoutChart(
      {
        channels,
        destinations,
        routes: [route("r1", ["gone"], "d1"), route("r2", ["c1"], "nope")],
      },
      WIDE,
    );
    expect(chart.lanes).toEqual([]);
  });

  it("grows taller with more rows and shortens long names", () => {
    const many = Array.from({ length: 5 }, (_, i) =>
      channel(`c${i}`, `A rather long channel name ${i}`),
    );
    const small = layoutChart({ channels, destinations, routes: [] }, WIDE);
    const tall = layoutChart(
      { channels: many, destinations, routes: [] },
      WIDE,
    );
    expect(tall.height).toBeGreaterThan(small.height);
    expect(tall.left[0]!.title).toMatch(/…$/);
    expect(Array.from(tall.left[0]!.title).length).toBe(WIDE.maxTitle);
  });
});
