import { ImageResponse } from "next/og";
import { SHIP, SHIP_BOX } from "@/app/components/ship";

// Repeated in app/components/share-image.ts, which the layouts read.
export const alt =
  "Ferry: your Buffer posts on Discord and Telegram. Pills for Discord, Telegram and Reddit drafts under the headline.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/*
 * The share card, in the landing's look: warm white, the logo, the
 * headline at its calm weight, and a pill for each place a post goes, in
 * that place's tint. Satori takes literal colours, so these repeat the
 * light values in app/styles/tokens.css.
 */
const PAPER = "#fcfbf7";
const INK = "#10231d";
const INK_2 = "#33433d";
const HARBOUR = "#0c3b2e";
const SHIP_WHITE = "#ffffff";
const FUNNEL = "#f5c935";
const PLACES = [
  { name: "Discord", tint: "#e5e0ff" },
  { name: "Telegram", tint: "#d8ebfa" },
  { name: "Reddit drafts", tint: "#ffe1d4" },
];

function Mark({ size: side }: { size: number }) {
  return (
    <div
      style={{
        display: "flex",
        width: side,
        height: side,
        borderRadius: side * 0.24,
        background: HARBOUR,
      }}
    >
      <svg width={side} height={side} viewBox={`0 0 ${SHIP_BOX} ${SHIP_BOX}`}>
        <path d={SHIP.wave} fill={SHIP_WHITE} />
        <path d={SHIP.funnel} fill={FUNNEL} />
        <path d={SHIP.wheelhouse} fill={SHIP_WHITE} />
        <path d={SHIP.cabin} fill={SHIP_WHITE} fillRule="evenodd" />
        <path d={SHIP.hull} fill={SHIP_WHITE} />
      </svg>
    </div>
  );
}

export default function OpenGraphImage() {
  return new ImageResponse(
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        padding: "64px 80px",
        background: PAPER,
        color: INK,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
        <Mark size={64} />
        <div style={{ display: "flex", fontSize: 40 }}>Ferry</div>
      </div>
      <div
        style={{
          display: "flex",
          marginTop: 56,
          maxWidth: 900,
          fontSize: 76,
          lineHeight: 1.06,
          letterSpacing: "-0.03em",
        }}
      >
        Your Buffer posts on Discord and Telegram
      </div>
      <div
        style={{
          display: "flex",
          marginTop: 28,
          fontSize: 30,
          color: INK_2,
        }}
      >
        Keep writing in Buffer. Ferry carries each post on.
      </div>
      <div style={{ display: "flex", gap: 16, marginTop: "auto" }}>
        {PLACES.map((place) => (
          <div
            key={place.name}
            style={{
              display: "flex",
              padding: "14px 28px",
              borderRadius: 999,
              background: place.tint,
              fontSize: 28,
            }}
          >
            {place.name}
          </div>
        ))}
      </div>
    </div>,
    size,
  );
}
