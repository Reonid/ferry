import { serviceLabel } from "../mirror/services";
import type { Channel, PublicDestination, Route } from "../types";

/**
 * Geometry for the crossing map, drawn as a small nautical chart: Buffer
 * channels on the left shore, destinations on the right, one sea lane per
 * channel and destination pair. Pure, so it renders the same on the server
 * and in the browser. Units are SVG user units.
 */
export interface ChartOptions {
  width: number;
  /** Width of each strip of land, where the names sit. */
  shore: number;
  rowHeight: number;
  padding: number;
  /** Longest name, in characters, before it is shortened. */
  maxTitle: number;
  /** Longest detail line under a name. */
  maxDetail: number;
  /** Gap between a coast and the names on it. */
  labelGap: number;
  /** Scales the depth contours, so a small chart keeps open water. */
  depth: number;
}

// Sized from measured label widths: "#announcements" in bold is about 114
// units on the wide chart (14px) and 98 on the narrow one (12px).
export const WIDE: ChartOptions = {
  width: 760,
  shore: 164,
  rowHeight: 64,
  padding: 46,
  maxTitle: 18,
  maxDetail: 24,
  labelGap: 14,
  depth: 1,
};

export const NARROW: ChartOptions = {
  width: 360,
  shore: 122,
  rowHeight: 62,
  padding: 44,
  maxTitle: 15,
  maxDetail: 17,
  labelGap: 12,
  depth: 0.55,
};

export interface Port {
  id: string;
  x: number;
  y: number;
  title: string;
  detail: string;
  /** Whether any route uses this port. */
  active: boolean;
}

export type LaneState = "running" | "paused" | "broken";

export interface Lane {
  key: string;
  channelId: string;
  destinationId: string;
  d: string;
  state: LaneState;
}

export interface Shore {
  land: string;
  /** Shallow water near the coast, then the shelf beyond it. */
  shallow: string;
  shelf: string;
  coast: string;
  contours: string[];
}

export interface Chart {
  width: number;
  height: number;
  left: Port[];
  right: Port[];
  lanes: Lane[];
  shores: [Shore, Shore];
  /** Where names sit on each shore: left names end here, right names start here. */
  labelX: [number, number];
}

const MIN_ROWS = 2;
const STEP = 6;
const PORT_GAP = 14;
/** How far a lane bows away from the straight line, per unit of its length. */
const BOW = 0.07;

/** Depth contours wander off the coast, the way soundings do. */
const CONTOURS: ((y: number) => number)[] = [
  (y) => 17 + 7 * Math.sin(y / 53 + 0.7) + 2.5 * Math.sin(y / 19),
  (y) => 42 + 12 * Math.sin(y / 71 + 2.1) + 4 * Math.sin(y / 23 + 1),
];

export function laneKey(channelId: string, destinationId: string): string {
  return `${channelId}>${destinationId}`;
}

const round = (n: number) => Math.round(n * 10) / 10;

function shorten(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join("")}…`;
}

/** A gentle, fixed coastline wobble, so both renders draw the same shore. */
function wobble(y: number, phase: number): number {
  return (
    4.5 * Math.sin((y + phase) / 29) + 2 * Math.sin((y + phase) / 9.5 + 1.7)
  );
}

function points(x: (y: number) => number, height: number): [number, number][] {
  const out: [number, number][] = [];
  for (let y = 0; y < height; y += STEP) out.push([round(x(y)), y]);
  out.push([round(x(height)), height]);
  return out;
}

function line(pts: [number, number][]): string {
  return pts.map(([x, y], i) => `${i === 0 ? "M" : "L"} ${x} ${y}`).join(" ");
}

function region(edge: number, pts: [number, number][], height: number): string {
  return `M ${edge} 0 ${pts.map(([x, y]) => `L ${x} ${y}`).join(" ")} L ${edge} ${height} Z`;
}

function shore(
  edge: number,
  coast: (y: number) => number,
  seaward: 1 | -1,
  height: number,
  phase: number,
  depth: number,
): Shore {
  const coastPts = points(coast, height);
  const contourPts = CONTOURS.map((offset) =>
    points((y) => coast(y) + seaward * depth * offset(y + phase), height),
  );
  return {
    land: region(edge, coastPts, height),
    shallow: region(edge, contourPts[0]!, height),
    shelf: region(edge, contourPts[1]!, height),
    coast: line(coastPts),
    contours: contourPts.map(line),
  };
}

function rows(count: number, height: number, padding: number): number[] {
  const span = (height - 2 * padding) / Math.max(count, 1);
  return Array.from({ length: count }, (_, i) =>
    round(padding + (i + 0.5) * span),
  );
}

export function layoutChart(
  input: {
    channels: Channel[];
    destinations: PublicDestination[];
    routes: Route[];
  },
  opts: ChartOptions,
): Chart {
  const { channels, destinations, routes } = input;
  const { width, shore: land, rowHeight, padding, maxTitle, maxDetail } = opts;
  const height =
    padding * 2 +
    Math.max(channels.length, destinations.length, MIN_ROWS) * rowHeight;

  const leftCoast = (y: number) => land + wobble(y, 0);
  const rightCoast = (y: number) => width - land - wobble(y, 41);

  const usedChannels = new Set(routes.flatMap((r) => r.channelIds));
  const usedDestinations = new Set(routes.map((r) => r.destinationId));

  const left: Port[] = rows(channels.length, height, padding).map((y, i) => {
    const c = channels[i]!;
    return {
      id: c.id,
      x: round(leftCoast(y) + PORT_GAP),
      y,
      title: shorten(c.displayName ?? c.name, maxTitle),
      detail: shorten(
        `${serviceLabel(c.service)}${c.isDisconnected ? ", disconnected" : ""}`,
        maxDetail,
      ),
      active: usedChannels.has(c.id),
    };
  });
  const right: Port[] = rows(destinations.length, height, padding).map(
    (y, i) => {
      const d = destinations[i]!;
      const network = d.kind === "telegram" ? "Telegram" : "Discord";
      const detail =
        d.kind === "reddit"
          ? "Reddit drafts"
          : d.status === "broken"
            ? `Reconnect ${network}`
            : network;
      return {
        id: d.id,
        x: round(rightCoast(y) - PORT_GAP),
        y,
        title: shorten(d.label, maxTitle),
        detail,
        active: usedDestinations.has(d.id),
      };
    },
  );

  const lanes = new Map<string, Lane>();
  for (const route of routes) {
    const to = right.find((p) => p.id === route.destinationId);
    const destination = destinations.find((d) => d.id === route.destinationId);
    if (!to || !destination) continue;
    for (const channelId of route.channelIds) {
      const from = left.find((p) => p.id === channelId);
      if (!from) continue;
      const key = laneKey(channelId, route.destinationId);
      const state: LaneState =
        destination.status === "broken"
          ? "broken"
          : route.paused
            ? "paused"
            : "running";
      const existing = lanes.get(key);
      if (existing) {
        if (existing.state === "paused" && state === "running")
          existing.state = "running";
        continue;
      }
      // Lanes bow gently, alternating up and down so shared ports fan out.
      const span = to.x - from.x;
      const pull = round(span * 0.42);
      const bow = round(span * BOW * (lanes.size % 2 === 0 ? -1 : 1));
      lanes.set(key, {
        key,
        channelId,
        destinationId: route.destinationId,
        d: `M ${from.x} ${from.y} C ${round(from.x + pull)} ${round(from.y + bow)}, ${round(to.x - pull)} ${round(to.y + bow)}, ${to.x} ${to.y}`,
        state,
      });
    }
  }

  return {
    width,
    height,
    left,
    right,
    lanes: [...lanes.values()],
    shores: [
      shore(0, leftCoast, 1, height, 0, opts.depth),
      shore(width, rightCoast, -1, height, 97, opts.depth),
    ],
    labelX: [land - opts.labelGap, width - land + opts.labelGap],
  };
}
