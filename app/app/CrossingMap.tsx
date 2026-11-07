"use client";

import { useEffect, useMemo, useRef, type Ref } from "react";
import { layoutChart, NARROW, WIDE, type Chart } from "@/lib/dashboard/chart";
import { mapLabel, newLandings, routable } from "@/lib/dashboard/view";
import type {
  ActivityEntry,
  Channel,
  PublicDestination,
  Route,
} from "@/lib/types";
import { cross, findLane, MAX_BOATS, STAGGER_MS } from "./crossing";
import { cx } from "./FormParts";
import styles from "./CrossingMap.module.css";

function ChartSvg({
  chart,
  label,
  className,
  ref,
}: {
  chart: Chart;
  label: string;
  className?: string;
  ref: Ref<SVGSVGElement>;
}) {
  const { width, height, lanes, left, right } = chart;
  const [leftX, rightX] = chart.labelX;
  const middle = height / 2;
  return (
    <svg
      ref={ref}
      className={cx(styles.svg, className)}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={label}
    >
      <rect className={styles.deep} width={width} height={height} />
      {chart.shores.map((shore, i) => (
        <g key={i}>
          <path className={styles.shelf} d={shore.shelf} />
          <path className={styles.shallow} d={shore.shallow} />
          {shore.contours.map((d, j) => (
            <path key={j} className={styles.contour} d={d} />
          ))}
          <path className={styles.land} d={shore.land} />
          <path className={styles.coast} d={shore.coast} />
        </g>
      ))}

      <text className={styles.caption} x={leftX} y={26} textAnchor="end">
        Buffer
      </text>
      <text className={styles.caption} x={rightX} y={26}>
        Destinations
      </text>

      {lanes.map((lane) => (
        <path
          key={lane.key}
          className={cx(styles.lane, styles[lane.state])}
          d={lane.d}
          data-lane={lane.key}
          data-channel={lane.channelId}
          data-destination={lane.destinationId}
        />
      ))}
      {lanes.length === 0 && left.length > 0 && right.length > 0 && (
        <text
          className={styles.water}
          x={width / 2}
          y={middle}
          textAnchor="middle"
        >
          No routes yet
        </text>
      )}

      {left.map((port) => (
        <g
          key={port.id}
          className={cx(styles.port, !port.active && styles.idle)}
        >
          <circle cx={port.x} cy={port.y} r={4.5} />
          <text
            className={styles.title}
            x={leftX}
            y={port.y - 2}
            textAnchor="end"
          >
            {port.title}
          </text>
          <text
            className={styles.detail}
            x={leftX}
            y={port.y + 14}
            textAnchor="end"
          >
            {port.detail}
          </text>
        </g>
      ))}
      {left.length === 0 && (
        <text className={styles.detail} x={leftX} y={middle} textAnchor="end">
          No channels yet
        </text>
      )}
      {right.map((port) => (
        <g
          key={port.id}
          className={cx(styles.port, !port.active && styles.idle)}
        >
          <circle cx={port.x} cy={port.y} r={4.5} />
          <text className={styles.title} x={rightX} y={port.y - 2}>
            {port.title}
          </text>
          <text className={styles.detail} x={rightX} y={port.y + 14}>
            {port.detail}
          </text>
        </g>
      ))}
      {right.length === 0 && (
        <text className={styles.detail} x={rightX} y={middle}>
          None connected yet
        </text>
      )}

      {/* Boats and lit lanes are added here by cross(). */}
      <g data-crossings="" />

      {/* The chart's border: a neatline, a graduated band, an inner line. */}
      <rect
        className={styles.neatline}
        x={0.75}
        y={0.75}
        width={width - 1.5}
        height={height - 1.5}
      />
      <rect
        className={styles.graduation}
        x={3.75}
        y={3.75}
        width={width - 7.5}
        height={height - 7.5}
      />
      <rect
        className={styles.inner}
        x={6.5}
        y={6.5}
        width={width - 13}
        height={height - 13}
      />
    </svg>
  );
}

/**
 * The crossing map: Buffer channels on the left shore, destinations on the
 * right, routes as sea lanes. It is an image to assistive tech, with every
 * route in its label; the route list below is its interactive twin.
 */
export default function CrossingMap({
  channels,
  destinations,
  routes,
  activity,
  label: givenLabel,
}: {
  channels: Channel[];
  destinations: PublicDestination[];
  routes: Route[];
  activity: ActivityEntry[];
  /** Replaces the label read from the routes, as the landing's example does. */
  label?: string;
}) {
  // A Telegram DM takes alerts only, so it gets no port on the far shore.
  const ports = useMemo(() => destinations.filter(routable), [destinations]);
  const wide = useMemo(
    () => layoutChart({ channels, destinations: ports, routes }, WIDE),
    [channels, ports, routes],
  );
  const narrow = useMemo(
    () => layoutChart({ channels, destinations: ports, routes }, NARROW),
    [channels, ports, routes],
  );
  const label = givenLabel ?? mapLabel(routes, channels, destinations);
  const wideRef = useRef<SVGSVGElement>(null);
  const narrowRef = useRef<SVGSVGElement>(null);
  const seen = useRef<ActivityEntry[] | null>(null);
  const timers = useRef<number[]>([]);

  // A delivery that wasn't in the previous snapshot sends a boat across.
  useEffect(() => {
    const landed = newLandings(seen.current, activity, channels).slice(
      0,
      MAX_BOATS,
    );
    seen.current = activity;
    if (landed.length === 0) return;
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    for (const svg of [wideRef.current, narrowRef.current]) {
      // Only the variant on screen sails; the other is display: none.
      if (!svg || svg.getClientRects().length === 0) continue;
      landed.forEach((landing, i) => {
        const lane = findLane(svg, landing.channelId, landing.destinationId);
        if (lane) cross(svg, lane, i * STAGGER_MS, reduced, timers.current);
      });
    }
  }, [activity, channels]);

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const id of pending) window.clearTimeout(id);
    };
  }, []);

  return (
    <div className={styles.chart}>
      <ChartSvg
        chart={wide}
        label={label}
        className={styles.wide}
        ref={wideRef}
      />
      <ChartSvg
        chart={narrow}
        label={label}
        className={styles.narrow}
        ref={narrowRef}
      />
    </div>
  );
}
