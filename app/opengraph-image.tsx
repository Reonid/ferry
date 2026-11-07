import { ImageResponse } from "next/og";
import { DECK, HULL } from "./components/boat";

export const alt =
  "Ferry carries your Buffer posts to the places Buffer doesn't go. A boat crosses a dashed route between two shores.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// The light chart's tokens, from app/globals.css.
const SEA = "#f3f7f8";
const SHELF = "#e3eef2";
const SHOAL = "#cfe2ea";
const SURFACE = "#ffffff";
const LAND = "#ebe2c6";
const COAST = "#8f7d52";
const INK = "#15283f";
const MUTED = "#44586c";
const ROUTE = "#a1197f";

const W = size.width;
const H = size.height;
const BOTTOM = H - 32;

/** A headland in the bottom-left corner, `out` units further into the sea. */
function headland(out: number): string {
  const x = (v: number) => v + out;
  return `M 32 ${360 - out} C ${x(90)} ${372 - out}, ${x(130)} ${410 - out * 0.4}, ${x(150)} 450 C ${x(168)} 486, ${x(196)} 506, ${x(208)} 540 C ${x(218)} 570, ${x(200)} 590, ${x(196)} ${BOTTOM} L 32 ${BOTTOM} Z`;
}

/** The same shape on the right-hand shore. */
function mirror(d: string): string {
  let i = 0;
  return d.replace(/-?\d+(?:\.\d+)?/g, (n) =>
    i++ % 2 === 0 ? String(W - Number(n)) : n,
  );
}

const SHORES = [
  { d: headland(56), fill: SHELF },
  { d: headland(26), fill: SHOAL },
  { d: headland(0), fill: LAND, stroke: COAST },
];

const FROM = { x: 222, y: 498 };
const TO = { x: W - 222, y: 498 };
const LANE = `M ${FROM.x} ${FROM.y} C 470 436, 730 436, ${TO.x} ${TO.y}`;
// The boat sits 62% of the way across, turned along the lane.
const BOAT = { x: 693, y: 452, angle: 3, scale: 3.4 };

export default function OpenGraphImage() {
  return new ImageResponse(
    <div
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        padding: "70px 76px",
        background: SEA,
        color: INK,
      }}
    >
      <svg
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        style={{ position: "absolute", left: 0, top: 0 }}
      >
        {SHORES.flatMap((shore) => [
          <path
            key={`l-${shore.fill}`}
            d={shore.d}
            fill={shore.fill}
            stroke={shore.stroke ?? "none"}
            strokeWidth={2}
          />,
          <path
            key={`r-${shore.fill}`}
            d={mirror(shore.d)}
            fill={shore.fill}
            stroke={shore.stroke ?? "none"}
            strokeWidth={2}
          />,
        ])}
        <path
          d={LANE}
          fill="none"
          stroke={ROUTE}
          strokeWidth={4.5}
          strokeDasharray="16 11"
          strokeLinecap="round"
        />
        {[FROM, TO].map((port) => (
          <circle
            key={port.x}
            cx={port.x}
            cy={port.y}
            r={8}
            fill={SURFACE}
            stroke={INK}
            strokeWidth={3}
          />
        ))}
        <g
          transform={`translate(${BOAT.x} ${BOAT.y}) rotate(${BOAT.angle}) scale(${BOAT.scale})`}
        >
          <path
            d="M -15 -2.6 L -25 -7 M -15 2.6 L -25 7"
            fill="none"
            stroke={ROUTE}
            strokeWidth={1.6}
            strokeLinecap="round"
          />
          <path d={HULL} fill={INK} stroke={SURFACE} strokeWidth={1.25} />
          <path d={DECK} fill={ROUTE} />
        </g>
        {/* The chart's border: a neatline, a graduated band, an inner line. */}
        <rect
          x={18}
          y={18}
          width={W - 36}
          height={H - 36}
          fill="none"
          stroke={INK}
          strokeWidth={2}
        />
        <rect
          x={24}
          y={24}
          width={W - 48}
          height={H - 48}
          fill="none"
          stroke={MUTED}
          strokeWidth={5}
          strokeDasharray="22 22"
        />
        <rect
          x={30}
          y={30}
          width={W - 60}
          height={H - 60}
          fill="none"
          stroke={INK}
          strokeWidth={1}
        />
      </svg>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 18,
          fontSize: 46,
        }}
      >
        <svg width={92} height={40} viewBox="-27 -9 42 18">
          <path
            d="M -15 -2.6 L -25 -7 M -15 2.6 L -25 7"
            fill="none"
            stroke={ROUTE}
            strokeWidth={1.6}
            strokeLinecap="round"
          />
          <path d={HULL} fill={INK} />
          <path d={DECK} fill={ROUTE} />
        </svg>
        Ferry
      </div>
      <div
        style={{
          display: "flex",
          marginTop: 40,
          maxWidth: 1000,
          fontSize: 64,
          lineHeight: 1.12,
          letterSpacing: "-0.01em",
        }}
      >
        Ferry carries your Buffer posts to the places Buffer doesn&apos;t go.
      </div>
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 62,
          display: "flex",
          justifyContent: "center",
          fontSize: 24,
          color: MUTED,
        }}
      >
        An independent project, not affiliated with Buffer.
      </div>
    </div>,
    size,
  );
}
