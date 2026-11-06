import { raiseAlert } from "../alerts";
import { BufferError } from "../buffer/client";
import { mapSyncData } from "../buffer/map";
import { buildSyncQuery, syncVariables } from "../buffer/queries";
import { TokenBusyError } from "../buffer/tokens";
import {
  HEARTBEAT_MAX_MS,
  LOCK_SYNC_MS,
  LOOKAHEAD_MS,
  OVERDUE_BASE_MS,
  OVERLAP_MS,
} from "../constants";
import { deliverToDestination, type DeliverDeps } from "../delivery/deliver";
import { serviceLabel } from "../mirror/services";
import { toMirrorPost } from "../mirror/to-mirror";
import { groupPosts } from "../routing/group";
import { routesForPost } from "../routing/match";
import { dayKey } from "../time";
import type {
  Account,
  Channel,
  Destination,
  Post,
  RateLimitSnapshot,
  Route,
} from "../types";
import { heartbeatMs, liveAllowed } from "./budget";
import { planNextSync } from "./planner";

export interface SyncDeps extends DeliverDeps {
  buffer: (args: {
    accessToken: string;
    query: string;
    variables: Record<string, unknown>;
  }) => Promise<{ data: unknown; rateLimit: RateLimitSnapshot | null }>;
  getAccessToken: (accountId: string) => Promise<string>;
  jitterMs?: () => number;
}

export interface SyncReport {
  status:
    "ok" | "locked" | "no_routes" | "needs_reauth" | "rate_limited" | "error";
  delivered: number;
  drafts: number;
  alerts: number;
  nextRunAt: number | null;
}

const HOUR_24 = 24 * 60 * 60 * 1000;

export function channelLabel(
  channels: Channel[],
  channelId: string,
  fallback: Channel["service"],
): string {
  const c = channels.find((x) => x.id === channelId);
  return c
    ? `${c.displayName ?? c.name} on ${serviceLabel(c.service)}`
    : serviceLabel(fallback);
}

export async function runSync(
  accountId: string,
  deps: SyncDeps,
): Promise<SyncReport> {
  const { store } = deps;
  const report: SyncReport = {
    status: "ok",
    delivered: 0,
    drafts: 0,
    alerts: 0,
    nextRunAt: null,
  };
  const lock = await store.acquireLock(`sync:${accountId}`, LOCK_SYNC_MS);
  if (lock === null) return { ...report, status: "locked" };
  const start = deps.now();

  async function schedule(at: number, retryAt?: number): Promise<void> {
    await store.scheduleSync(accountId, at);
    const state = await store.getSyncState(accountId);
    await store.putSyncState(accountId, {
      ...state,
      nextRunAt: at,
      ...(retryAt !== undefined ? { retryAt } : {}),
    });
    report.nextRunAt = at;
  }
  async function alert(
    account: Account,
    key: string,
    message: string,
    supportUrl: string | null,
  ): Promise<void> {
    if (await raiseAlert({ deps, account, key, message, supportUrl }))
      report.alerts++;
  }

  try {
    const account = await store.getAccount(accountId);
    if (!account) {
      await store.unscheduleSync(accountId);
      return { ...report, status: "no_routes" };
    }
    if (account.status === "needs_reauth") {
      await schedule(start + HEARTBEAT_MAX_MS);
      return { ...report, status: "needs_reauth" };
    }

    const destinations = await store.listDestinations(accountId);
    const destById = new Map<string, Destination>(
      destinations.map((d) => [d.id, d]),
    );
    const routes = (await store.listRoutes(accountId)).filter(
      (r) => !r.paused && destById.get(r.destinationId)?.status === "active",
    );
    const cached = await store.getChannels(accountId);
    const sourceIds = new Set(routes.flatMap((r) => r.channelIds));
    const orgOf = (channelId: string): string | undefined =>
      cached.find((c) => c.id === channelId)?.organizationId ??
      (account.organizationIds.length === 1
        ? account.organizationIds[0]
        : undefined);
    const byOrg = new Map<string, string[]>();
    for (const id of sourceIds) {
      const org = orgOf(id);
      if (org === undefined) continue;
      byOrg.set(org, [...(byOrg.get(org) ?? []), id]);
    }
    const orgs = [...byOrg].map(([organizationId, channelIds]) => ({
      organizationId,
      channelIds,
    }));
    if (orgs.length === 0) {
      await store.unscheduleSync(accountId);
      const state = await store.getSyncState(accountId);
      await store.putSyncState(accountId, { ...state, nextRunAt: null });
      return { ...report, status: "no_routes" };
    }

    const state = await store.getSyncState(accountId);
    const since =
      state.checkpoint !== null
        ? state.checkpoint - OVERLAP_MS
        : Math.min(...routes.map((r) => r.activeSince));
    const until = start + LOOKAHEAD_MS;

    try {
      const accessToken = await deps.getAccessToken(accountId);
      await store.countApiCall(accountId, dayKey(start));
      const { data, rateLimit } = await deps.buffer({
        accessToken,
        query: buildSyncQuery(orgs.length),
        variables: syncVariables({ orgs, since, until }),
      });
      if (rateLimit) await store.putRateLimit(rateLimit);
      const mapped = mapSyncData(data, orgs.length);

      const queried = new Set(orgs.map((o) => o.organizationId));
      const channels = [
        ...cached.filter((c) => !queried.has(c.organizationId)),
        ...mapped.channels,
      ];
      await store.putChannels(accountId, channels);

      await deliverAll(account, mapped.posts, routes, destById, channels);
      await raiseProblems(
        account,
        mapped.posts,
        mapped.channels,
        sourceIds,
        channels,
      );

      const dueTimes = mapped.upcoming.map((u) => Date.parse(u.dueAt));
      const overdue = dueTimes.some((t) => t <= start);
      const snapshot = await store.getRateLimit();
      const heartbeat = heartbeatMs({
        snapshot,
        activeAccounts: await store.countScheduled(),
        dueSyncsPerDay: dueTimes.filter((t) => t <= start + HOUR_24).length,
        now: start,
      });
      const latest = await store.getSyncState(accountId);
      const plan = planNextSync({
        now: start,
        upcomingDueAt: dueTimes,
        overdueAttempts: overdue ? state.overdueAttempts + 1 : 0,
        heartbeatMs: heartbeat,
        liveUntil: latest.liveUntil,
        liveAllowed: liveAllowed(snapshot, start),
      });
      await store.scheduleSync(accountId, plan.at);
      await store.putSyncState(accountId, {
        ...latest,
        checkpoint: start,
        lastSyncAt: start,
        overdueAttempts: overdue ? state.overdueAttempts + 1 : 0,
        nextRunAt: plan.at,
        retryAt: null,
      });
      report.nextRunAt = plan.at;
      return report;
    } catch (err) {
      if (err instanceof BufferError && err.kind === "auth") {
        await store.putAccount({ ...account, status: "needs_reauth" });
        await alert(
          account,
          "buffer-auth",
          "Buffer disconnected Ferry. Sign in again to keep posts crossing.",
          null,
        );
        await schedule(start + HEARTBEAT_MAX_MS);
        return { ...report, status: "needs_reauth" };
      }
      if (err instanceof BufferError && err.kind === "rate_limit") {
        const at =
          start +
          (err.retryAfterMs ?? OVERDUE_BASE_MS) +
          (deps.jitterMs?.() ?? 0);
        await schedule(at, at);
        return { ...report, status: "rate_limited" };
      }
      await schedule(start + 2 * OVERDUE_BASE_MS, start + 2 * OVERDUE_BASE_MS);
      if (err instanceof BufferError || err instanceof TokenBusyError)
        return { ...report, status: "error" };
      throw err;
    }

    async function deliverAll(
      account: Account,
      posts: Post[],
      active: Route[],
      destMap: Map<string, Destination>,
      channels: Channel[],
    ): Promise<void> {
      const buckets = new Map<string, Map<string, Post>>();
      for (const post of posts) {
        for (const route of routesForPost(post, active)) {
          const bucket = buckets.get(route.destinationId) ?? new Map();
          bucket.set(post.id, post);
          buckets.set(route.destinationId, bucket);
        }
      }
      for (const [destId, bucket] of buckets) {
        const destination = destMap.get(destId);
        if (!destination) continue;
        for (const group of groupPosts([...bucket.values()])) {
          const status = await deliverToDestination({
            account,
            destination,
            mirror: toMirrorPost(group, channels),
            deps,
          });
          if (status === "delivered") report.delivered++;
          if (status === "draft_ready") report.drafts++;
        }
      }
    }

    async function raiseProblems(
      account: Account,
      posts: Post[],
      fresh: Channel[],
      source: Set<string>,
      channels: Channel[],
    ): Promise<void> {
      for (const post of posts) {
        if (post.status !== "error" || !source.has(post.channelId)) continue;
        const label = channelLabel(channels, post.channelId, post.service);
        await alert(
          account,
          `post-error:${post.id}`,
          `Buffer couldn't publish a post to ${label}: ${post.error?.message ?? "unknown error"}`,
          post.error?.supportUrl ?? null,
        );
      }
      for (const channel of fresh) {
        if (!source.has(channel.id)) continue;
        const label = channelLabel(channels, channel.id, channel.service);
        const dKey = `chan-disconnected:${channel.id}`;
        const pKey = `chan-paused:${channel.id}`;
        if (channel.isDisconnected)
          await alert(
            account,
            dKey,
            `${label} is disconnected in Buffer, so its posts won't go out.`,
            null,
          );
        else await store.clearAlertKey(accountId, dKey);
        if (channel.isQueuePaused)
          await alert(
            account,
            pKey,
            `${label}'s queue is paused in Buffer.`,
            null,
          );
        else await store.clearAlertKey(accountId, pKey);
      }
    }
  } finally {
    await store.releaseLock(`sync:${accountId}`, lock);
  }
}
