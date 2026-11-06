"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { LIVE_POLL_MS } from "@/lib/constants";
import type { DashboardSnapshot } from "@/lib/dashboard/snapshot";
import SiteHeader from "../components/SiteHeader";
import Activity from "./Activity";
import Alerts, { Banner, type Notice } from "./Alerts";
import CrossingMap from "./CrossingMap";
import Destinations from "./Destinations";
import DraftsTray from "./DraftsTray";
import RouteList from "./RouteList";
import Settings from "./Settings";
import StatusLine from "./StatusLine";
import styles from "./Dashboard.module.css";

const CLOCK_MS = 15_000;

interface Polled {
  data: DashboardSnapshot;
  /** The page snapshot this poll started from. */
  base: DashboardSnapshot;
  at: number;
}

/**
 * Polls /api/live every LIVE_POLL_MS while the tab is visible, and once more
 * as soon as it becomes visible again. While the dashboard polls, the live
 * endpoint keeps the account in live mode, so crossings show up quickly.
 */
function useLiveSnapshot(
  base: RefObject<DashboardSnapshot>,
  onSnapshot: (polled: Polled) => void,
): void {
  useEffect(() => {
    let timer: number | undefined;
    let request: AbortController | null = null;
    let stopped = false;

    function schedule() {
      if (stopped || timer !== undefined) return;
      if (document.visibilityState !== "visible") return;
      timer = window.setTimeout(() => {
        timer = undefined;
        void poll();
      }, LIVE_POLL_MS);
    }

    async function poll() {
      if (stopped || request || document.visibilityState !== "visible") return;
      request = new AbortController();
      const from = base.current;
      try {
        const res = await fetch("/api/live", {
          cache: "no-store",
          signal: request.signal,
        });
        if (res.status === 401) stopped = true;
        else if (res.ok)
          onSnapshot({
            data: (await res.json()) as DashboardSnapshot,
            base: from,
            at: Date.now(),
          });
      } catch {
        // Offline or aborted: the next poll tries again.
      } finally {
        request = null;
      }
      schedule();
    }

    function onVisibility() {
      window.clearTimeout(timer);
      timer = undefined;
      if (document.visibilityState === "visible") void poll();
    }

    void poll();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      request?.abort();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [base, onSnapshot]);
}

/** A clock for relative times. It starts at the server's render time, so hydration matches. */
function useClock(start: number): number {
  const [now, setNow] = useState(start);
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), CLOCK_MS);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

export default function Dashboard({
  snapshot,
  renderedAt,
  notice,
}: {
  snapshot: DashboardSnapshot;
  renderedAt: number;
  notice: Notice | null;
}) {
  const [polled, setPolled] = useState<Polled | null>(null);
  const base = useRef(snapshot);
  useEffect(() => {
    base.current = snapshot;
  }, [snapshot]);
  useLiveSnapshot(base, setPolled);
  const clock = useClock(renderedAt);

  // A server action re-renders the page with a fresh snapshot, which then
  // wins over any poll that started before it.
  const fresh = polled !== null && polled.base === snapshot;
  const live = fresh ? polled.data : snapshot;
  // Relative times use the newest moment known: the clock, the latest
  // server render, or the latest poll.
  const now = Math.max(clock, renderedAt, fresh ? polled.at : 0);

  useEffect(() => {
    // Show the Discord result once; a reload shouldn't repeat it.
    if (notice)
      window.history.replaceState(
        window.history.state,
        "",
        window.location.pathname,
      );
  }, [notice]);

  return (
    <>
      <SiteHeader brand="heading">
        <nav aria-label="Dashboard" className={styles.nav}>
          <a href="#routes">Routes</a>
          <a href="#activity">Activity</a>
          <a href="#settings">Settings</a>
        </nav>
      </SiteHeader>
      <main className={styles.main}>
        <Banner
          needsReauth={live.account.status === "needs_reauth"}
          notice={notice}
        />
        <div className={styles.stack}>
          <div className={styles.hero}>
            <StatusLine
              routes={live.routes}
              nextRunAt={live.nextRunAt}
              apiCallsToday={live.apiCallsToday}
              now={now}
            />
            <CrossingMap
              channels={live.channels}
              destinations={live.destinations}
              routes={live.routes}
              activity={live.activity}
            />
          </div>
          <Alerts alerts={live.alerts} now={now} />
          <div className={styles.columns}>
            <div className={styles.column}>
              <RouteList
                routes={live.routes}
                channels={live.channels}
                destinations={live.destinations}
              />
              <Destinations
                destinations={live.destinations}
                routes={live.routes}
              />
            </div>
            <div className={styles.column}>
              <Activity
                activity={live.activity}
                destinations={live.destinations}
                now={now}
              />
              <DraftsTray
                drafts={live.drafts}
                destinations={live.destinations}
                now={now}
              />
            </div>
          </div>
          <Settings
            accountName={live.account.name}
            destinations={live.destinations}
            notifyDestinationId={live.notifyDestinationId}
          />
        </div>
      </main>
    </>
  );
}
