"use client";

import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import styles from "./Places.module.css";

export interface Place {
  id: "discord" | "telegram" | "reddit";
  /** The tab's id and its panel's, written out where the page lists them. */
  tabId: string;
  panelId: string;
  tab: string;
  text: string;
  /** What arrives there, as a short check-list. */
  points: string[];
  link: { href: string; label: string };
  preview: ReactNode;
}

/**
 * The same post in Discord, in Telegram and as a Reddit draft, behind
 * pill tabs. The tabs and each place's words sit in one column beside
 * the place itself, on a card in that place's tint. Arrow keys, Home and
 * End move between the tabs. With scripting off, every panel and every
 * place shows, one after another.
 */
export default function PlacesSwitcher({
  places,
  intro,
}: {
  places: Place[];
  /** The section's head and line, at the top of the words' column. */
  intro: ReactNode;
}) {
  const [current, setCurrent] = useState(0);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);

  function select(index: number) {
    const next = (index + places.length) % places.length;
    setCurrent(next);
    tabs.current[next]?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const moves: Record<string, number> = {
      ArrowRight: current + 1,
      ArrowLeft: current - 1,
      Home: 0,
      End: places.length - 1,
    };
    const to = moves[event.key];
    if (to === undefined) return;
    event.preventDefault();
    select(to);
  }

  const state = (i: number) => (i === current ? "active" : "inactive");

  return (
    <div className={styles.switcher}>
      <div className={styles.side}>
        <div className={styles.intro}>{intro}</div>
        <div
          role="tablist"
          aria-label="Destinations"
          className={styles.keys}
          onKeyDown={onKeyDown}
        >
          {places.map((place, i) => (
            <button
              key={place.id}
              ref={(el) => {
                tabs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={place.tabId}
              aria-selected={i === current}
              aria-controls={place.panelId}
              tabIndex={i === current ? 0 : -1}
              className={styles.key}
              onClick={() => setCurrent(i)}
            >
              {place.tab}
            </button>
          ))}
        </div>
        {places.map((place, i) => (
          <div
            key={place.id}
            role="tabpanel"
            id={place.panelId}
            aria-labelledby={place.tabId}
            data-state={state(i)}
            className={styles.panel}
          >
            <p>{place.text}</p>
            <ul className={styles.points}>
              {place.points.map((point) => (
                <li key={point}>
                  <svg viewBox="0 0 16 16" aria-hidden="true">
                    <path d="M3 8.5 6.5 12 13 4.5" />
                  </svg>
                  {point}
                </li>
              ))}
            </ul>
            <a href={place.link.href} className={styles.panelLink}>
              {place.link.label}
            </a>
          </div>
        ))}
      </div>
      <div className={styles.stage}>
        {places.map((place, i) => (
          <div
            key={place.id}
            className={styles.band}
            data-state={state(i)}
            data-place={place.id}
            data-slot={`place-${place.id}`}
            data-kind="product"
            data-alt={`A real post that crossed to ${place.tab}`}
          >
            {place.preview}
          </div>
        ))}
      </div>
    </div>
  );
}
