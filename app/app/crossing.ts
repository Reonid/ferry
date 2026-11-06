import { DECK, HULL } from "../components/boat";
import styles from "./CrossingMap.module.css";

/**
 * The crossing animation: a boat sails a lane once, drawing its wake, and a
 * ripple marks where it lands. Under reduced motion the lane lights up and
 * stays still instead. CSS and SVG only, no animation library. Imperative
 * on purpose: these elements live for a few seconds and React never sees
 * them; they go in the SVG's empty [data-crossings] layer.
 */

/** At most this many boats per update; the rest still show in Activity. */
export const MAX_BOATS = 5;
export const STAGGER_MS = 450;

const SAIL_MS = 2600;
const BOAT_SCALE = 1.3;
const LINGER_MS = 1200;
const LIT_MS = 5000;
const SVG_NS = "http://www.w3.org/2000/svg";

function make(
  tag: string,
  attrs: Record<string, string | undefined>,
): SVGElement {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs))
    if (value !== undefined) el.setAttribute(name, value);
  return el;
}

/** A lane's last point, from its path data ("M x y C … x y"). */
function laneEnd(d: string): [string, string] | null {
  const numbers = d.match(/-?\d+(?:\.\d+)?/g);
  const x = numbers?.at(-2);
  const y = numbers?.at(-1);
  return x !== undefined && y !== undefined ? [x, y] : null;
}

/** The lane a delivery took, or any lane into its destination. */
export function findLane(
  svg: SVGSVGElement,
  channelId: string | null,
  destinationId: string,
): SVGPathElement | null {
  const lanes = Array.from(
    svg.querySelectorAll<SVGPathElement>("path[data-lane]"),
  );
  return (
    lanes.find(
      (l) =>
        l.dataset.channel === channelId &&
        l.dataset.destination === destinationId,
    ) ??
    lanes.find((l) => l.dataset.destination === destinationId) ??
    null
  );
}

export function cross(
  svg: SVGSVGElement,
  lane: SVGPathElement,
  delay: number,
  reduced: boolean,
  timers: number[],
): void {
  const layer = svg.querySelector("[data-crossings]");
  const d = lane.getAttribute("d");
  if (!layer || !d) return;
  const later = (ms: number, run: () => void) =>
    timers.push(window.setTimeout(run, ms));

  if (reduced) {
    const lit = make("path", { d, class: styles.lit, "data-lit": "" });
    later(delay, () => layer.append(lit));
    later(delay + LIT_MS, () => lit.remove());
    return;
  }

  const end = laneEnd(d);
  later(delay, () => {
    const wake = make("path", { d, pathLength: "1", class: styles.wake });
    const boat = make("g", { class: styles.boat, "data-boat": "" });
    const motion = make("animateMotion", {
      path: d,
      dur: `${SAIL_MS}ms`,
      begin: "indefinite",
      fill: "freeze",
      rotate: "auto",
      calcMode: "spline",
      keyTimes: "0;1",
      keyPoints: "0;1",
      keySplines: "0.45 0 0.55 1",
    }) as SVGAnimationElement;
    const glyph = make("g", { transform: `scale(${BOAT_SCALE})` });
    glyph.append(
      make("path", { d: HULL, class: styles.hull }),
      make("path", { d: DECK, class: styles.deck }),
    );
    boat.append(glyph, motion);
    for (const el of [wake, boat])
      el.style.setProperty("--sail", `${SAIL_MS}ms`);
    layer.append(wake, boat);
    motion.beginElement();

    if (end)
      later(SAIL_MS - 200, () => {
        const ripple = make("circle", {
          cx: end[0],
          cy: end[1],
          r: "6",
          class: styles.ripple,
        });
        layer.append(ripple);
        later(1000, () => ripple.remove());
      });
    later(SAIL_MS + LINGER_MS, () => {
      wake.remove();
      boat.remove();
    });
  });
}
