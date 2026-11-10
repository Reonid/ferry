"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { LIVE_POLL_MS } from "@/lib/constants";
import type { DashboardSnapshot } from "@/lib/dashboard/snapshot";
import type { Connection } from "@/lib/oauth/connections";
import SiteHeader from "@/app/components/SiteHeader";
import header from "@/app/components/SiteHeader.module.css";
import Activity from "./Activity";
import Alerts, { Banner, type Notice } from "./Alerts";
import CrossingMap from "./CrossingMap";
import Destinations from "./Destinations";
import DraftsTray from "./DraftsTray";
import { cx } from "./FormParts";
import GetStarted from "./GetStarted";
import RouteList from "./RouteList";
import Settings from "./Settings";
import StatusLine, { syncMode, type SyncMode } from "./StatusLine";
import styles from "./Dashboard.module.css";

const CLOCK_MS = 15_000;

/** The word beside the status line: what Ferry is doing for this account. */
const SYNC_LABEL: Record<SyncMode, string> = {
  live: "Live",
  paused: "Paused",
  empty: "Not started",
  reauth: "Needs sign-in",
};

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
  assistants,
  mcpUrl,
  renderedAt,
  notice,
  telegramEnabled,
}: {
  snapshot: DashboardSnapshot;
  /** AI apps connected through Ferry's MCP server, newest first. */
  assistants: Connection[];
  /** The address apps connect to. */
  mcpUrl: string;
  renderedAt: number;
  notice: Notice | null;
  /** Static config, so it stays out of the snapshot /api/live returns. */
  telegramEnabled: boolean;
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
  const sync = syncMode(live.routes, live.account.status);

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
        <nav aria-label="Dashboard" className={header.nav}>
          <a href="#routes" className={header.link}>
            Routes
          </a>
          <a href="#activity" className={header.link}>
            Activity
          </a>
          <a href="#settings" className={header.link}>
            Settings
          </a>
        </nav>
      </SiteHeader>
      <main id="main" className={styles.main}>
        <Banner
          needsReauth={live.account.status === "needs_reauth"}
          notice={notice}
        />
        {/* One column, in the order people need it: what needs them, where
            posts go, what crossed, then the places and the settings. */}
        <div className={styles.stack}>
          <GetStarted
            destinations={live.destinations}
            routes={live.routes}
            activity={live.activity}
          />
          <Alerts alerts={live.alerts} now={now} />
          <RouteList
            routes={live.routes}
            channels={live.channels}
            destinations={live.destinations}
            status={
              <div className={styles.status}>
                <p className={cx(styles.sync, styles[`${sync}Sync`])}>
                  {SYNC_LABEL[sync]}
                </p>
                <StatusLine
                  mode={sync}
                  nextRunAt={live.nextRunAt}
                  apiCallsToday={live.apiCallsToday}
                  now={now}
                />
              </div>
            }
            map={
              <div className={styles.chart}>
                <CrossingMap
                  channels={live.channels}
                  destinations={live.destinations}
                  routes={live.routes}
                  activity={live.activity}
                />
              </div>
            }
          />
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
          <Destinations
            destinations={live.destinations}
            routes={live.routes}
            telegramEnabled={telegramEnabled}
          />
          <Settings
            accountName={live.account.name}
            destinations={live.destinations}
            notifyDestinationId={live.notifyDestinationId}
            telegramEnabled={telegramEnabled}
            assistants={assistants}
            mcpUrl={mcpUrl}
            now={now}
          />
        </div>
      </main>
    </>
  );
}
