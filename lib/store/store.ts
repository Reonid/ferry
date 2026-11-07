import { decrypt, encrypt, newToken } from "@/lib/crypto";
import {
  ACTIVITY_TTL_S,
  ALERT_DEDUPE_TTL_S,
  ALERTS_KEPT,
  DRAFT_TTL_S,
  RETRY_JOB_TTL_S,
  TELEGRAM_LINK_TTL_S,
  TELEGRAM_OFFSET_TTL_S,
} from "@/lib/constants";
import type {
  Account,
  ActivityEntry,
  Alert,
  Channel,
  Destination,
  RateLimitSnapshot,
  RedditDraft,
  RetryJob,
  Route,
  TelegramLink,
  SyncState,
  TokenSet,
} from "@/lib/types";
import type { RedisLike } from "./redis-like";

const CALLS_TTL_S = 2 * 24 * 60 * 60;
/** Most expired activity index members dropped per write. */
const TRIM_BATCH = 100;

export interface Store {
  getAccount(id: string): Promise<Account | null>;
  putAccount(a: Account): Promise<void>;
  getTokens(id: string): Promise<TokenSet | null>;
  putTokens(id: string, t: TokenSet): Promise<void>;
  getChannels(id: string): Promise<Channel[]>;
  putChannels(id: string, cs: Channel[]): Promise<void>;
  listRoutes(id: string): Promise<Route[]>;
  getRoute(routeId: string): Promise<Route | null>;
  putRoute(r: Route): Promise<void>;
  deleteRoute(id: string, routeId: string): Promise<void>;
  listDestinations(id: string): Promise<Destination[]>;
  getDestination(destId: string): Promise<Destination | null>;
  putDestination(d: Destination): Promise<void>;
  deleteDestination(id: string, destId: string): Promise<void>;
  /** Kept for `ttlSeconds`, the code's full life unless given. */
  putTelegramLink(
    code: string,
    link: TelegramLink,
    ttlSeconds?: number,
  ): Promise<void>;
  getTelegramLink(code: string): Promise<TelegramLink | null>;
  /** Per bot, by the public id that starts its token. */
  getTelegramOffset(botId: string): Promise<number>;
  /** Kept for a day, as long as Telegram keeps updates. */
  putTelegramOffset(botId: string, n: number): Promise<void>;
  getSyncState(id: string): Promise<SyncState>;
  putSyncState(id: string, s: SyncState): Promise<void>;
  scheduleSync(id: string, at: number): Promise<void>;
  unscheduleSync(id: string): Promise<void>;
  dueAccounts(now: number, limit: number): Promise<string[]>;
  countScheduled(): Promise<number>;
  acquireLock(name: string, ttlMs: number): Promise<string | null>;
  releaseLock(name: string, token: string): Promise<void>;
  claim(key: string, ttlSeconds: number): Promise<boolean>;
  releaseClaims(keys: string[]): Promise<void>;
  putRetry(job: RetryJob, at: number): Promise<void>;
  getRetry(jobId: string): Promise<RetryJob | null>;
  dueRetries(now: number, limit: number): Promise<RetryJob[]>;
  deleteRetry(jobId: string): Promise<void>;
  upsertActivity(id: string, entry: ActivityEntry): Promise<void>;
  getActivity(id: string, groupKey: string): Promise<ActivityEntry | null>;
  listActivity(id: string, limit: number): Promise<ActivityEntry[]>;
  putDraft(d: RedditDraft): Promise<void>;
  getDraft(token: string): Promise<RedditDraft | null>;
  listDrafts(id: string, limit: number): Promise<RedditDraft[]>;
  raiseAlertOnce(id: string, alert: Alert): Promise<boolean>;
  clearAlertKey(id: string, key: string): Promise<void>;
  listAlerts(id: string, limit: number): Promise<Alert[]>;
  putRateLimit(s: RateLimitSnapshot): Promise<void>;
  getRateLimit(): Promise<RateLimitSnapshot | null>;
  countApiCall(id: string, day: string): Promise<number>;
  getApiCalls(id: string, day: string): Promise<number>;
  deleteAccountData(id: string): Promise<void>;
}

const k = {
  account: (id: string) => `ferry:account:${id}`,
  tokens: (id: string) => `ferry:tokens:${id}`,
  channels: (id: string) => `ferry:channels:${id}`,
  routes: (id: string) => `ferry:routes:${id}`,
  route: (routeId: string) => `ferry:route:${routeId}`,
  dests: (id: string) => `ferry:dests:${id}`,
  dest: (destId: string) => `ferry:dest:${destId}`,
  sync: (id: string) => `ferry:sync:${id}`,
  syncDue: "ferry:sync:due",
  lock: (name: string) => `ferry:lock:${name}`,
  claim: (key: string) => `ferry:claim:${key}`,
  retryDue: "ferry:retry:due",
  retry: (jobId: string) => `ferry:retry:${jobId}`,
  act: (id: string, groupKey: string) => `ferry:act:${id}:${groupKey}`,
  acts: (id: string) => `ferry:acts:${id}`,
  tgLink: (code: string) => `ferry:tglink:${code}`,
  tgOffset: (botId: string) => `ferry:tg:offset:${botId}`,
  draft: (token: string) => `ferry:draft:${token}`,
  drafts: (id: string) => `ferry:drafts:${id}`,
  alertKey: (id: string, key: string) => `ferry:alertkey:${id}:${key}`,
  alerts: (id: string) => `ferry:alerts:${id}`,
  rateLimit: "ferry:ratelimit",
  calls: (id: string, day: string) => `ferry:calls:${id}:${day}`,
};

export function createStore(redis: RedisLike, key: Buffer): Store {
  async function getJson<T>(redisKey: string): Promise<T | null> {
    const raw = await redis.get(redisKey);
    return raw === null ? null : (JSON.parse(raw) as T);
  }
  async function setJson(
    redisKey: string,
    value: unknown,
    opts?: { ex?: number },
  ): Promise<void> {
    await redis.set(redisKey, JSON.stringify(value), opts);
  }
  async function mgetJson<T>(keys: string[]): Promise<(T | null)[]> {
    if (keys.length === 0) return [];
    const raws = await redis.mget(...keys);
    return raws.map((r) => (r === null ? null : (JSON.parse(r) as T)));
  }
  async function del(...keys: string[]): Promise<void> {
    if (keys.length > 0) await redis.del(...keys);
  }
  /** Members of an index zset (newest first) resolved to records; members whose record expired are pruned. */
  async function listIndexed<T>(
    indexKey: string,
    recordKey: (member: string) => string,
    limit: number,
  ): Promise<T[]> {
    if (limit <= 0) return [];
    const members = await redis.zrange(indexKey, 0, limit - 1, { rev: true });
    const records = await mgetJson<T>(members.map(recordKey));
    const live: T[] = [];
    const stale: string[] = [];
    records.forEach((record, i) => {
      const member = members[i];
      if (record === null) {
        if (member !== undefined) stale.push(member);
      } else live.push(record);
    });
    if (stale.length > 0) await redis.zrem(indexKey, ...stale);
    return live;
  }
  async function listSet<T>(
    setKey: string,
    recordKey: (member: string) => string,
  ): Promise<T[]> {
    const members = await redis.smembers(setKey);
    const records = await mgetJson<T>(members.map(recordKey));
    return records.filter((r): r is T => r !== null);
  }

  /**
   * Drops activity index members older than the window whose records have
   * expired. The score is the post's publish time, and an entry can be
   * written long after that (a test send of an old post, a catch-up sync),
   * so the score alone can't say a record is gone: dropping a live one would
   * hide it from the dashboard and from deleteAccountData.
   */
  async function trimActivityIndex(id: string): Promise<void> {
    const old = await redis.zrange(
      k.acts(id),
      "-inf",
      Date.now() - ACTIVITY_TTL_S * 1000,
      { byScore: true, offset: 0, count: TRIM_BATCH },
    );
    if (old.length === 0) return;
    const records = await redis.mget(...old.map((g) => k.act(id, g)));
    const gone = old.filter((_, i) => records[i] === null);
    if (gone.length > 0) await redis.zrem(k.acts(id), ...gone);
  }

  function sealDestination(d: Destination): Destination {
    return d.kind === "discord"
      ? { ...d, webhookToken: encrypt(d.webhookToken, key) }
      : d;
  }
  function openDestination(d: Destination | null): Destination | null {
    if (d === null) return null;
    return d.kind === "discord"
      ? { ...d, webhookToken: decrypt(d.webhookToken, key) }
      : d;
  }

  return {
    getAccount: (id) => getJson<Account>(k.account(id)),
    putAccount: (a) => setJson(k.account(a.accountId), a),

    async getTokens(id) {
      const sealed = await redis.get(k.tokens(id));
      return sealed === null
        ? null
        : (JSON.parse(decrypt(sealed, key)) as TokenSet);
    },
    async putTokens(id, t) {
      await redis.set(k.tokens(id), encrypt(JSON.stringify(t), key));
    },

    async getChannels(id) {
      return (await getJson<Channel[]>(k.channels(id))) ?? [];
    },
    putChannels: (id, cs) => setJson(k.channels(id), cs),

    async listRoutes(id) {
      const routes = await listSet<Route>(k.routes(id), k.route);
      return routes.sort((a, b) => a.createdAt - b.createdAt);
    },
    getRoute: (routeId) => getJson<Route>(k.route(routeId)),
    async putRoute(r) {
      await setJson(k.route(r.id), r);
      await redis.sadd(k.routes(r.accountId), r.id);
    },
    async deleteRoute(id, routeId) {
      await redis.srem(k.routes(id), routeId);
      await del(k.route(routeId));
    },

    async listDestinations(id) {
      const dests = await listSet<Destination>(k.dests(id), k.dest);
      return dests
        .sort((a, b) => a.createdAt - b.createdAt)
        .map((d) => openDestination(d) as Destination);
    },
    async getDestination(destId) {
      return openDestination(await getJson<Destination>(k.dest(destId)));
    },
    async putDestination(d) {
      await setJson(k.dest(d.id), sealDestination(d));
      await redis.sadd(k.dests(d.accountId), d.id);
    },
    putTelegramLink: (code, link, ttlSeconds = TELEGRAM_LINK_TTL_S) =>
      setJson(k.tgLink(code), link, { ex: ttlSeconds }),
    getTelegramLink: (code) => getJson<TelegramLink>(k.tgLink(code)),
    async getTelegramOffset(botId) {
      return (await getJson<number>(k.tgOffset(botId))) ?? 0;
    },
    putTelegramOffset: (botId, n) =>
      setJson(k.tgOffset(botId), n, { ex: TELEGRAM_OFFSET_TTL_S }),

    async deleteDestination(id, destId) {
      await redis.srem(k.dests(id), destId);
      await del(k.dest(destId));
    },

    async getSyncState(id) {
      // Defaults also fill fields added after a state was saved.
      return {
        checkpoint: null,
        overdueAttempts: 0,
        lastSyncAt: null,
        nextRunAt: null,
        liveUntil: null,
        lastSendLatestAt: null,
        retryAt: null,
        failureCount: 0,
        ...(await getJson<SyncState>(k.sync(id))),
      };
    },
    putSyncState: (id, s) => setJson(k.sync(id), s),

    async scheduleSync(id, at) {
      await redis.zadd(k.syncDue, { score: at, member: id });
    },
    async unscheduleSync(id) {
      await redis.zrem(k.syncDue, id);
    },
    dueAccounts: (now, limit) =>
      limit <= 0
        ? Promise.resolve([])
        : redis.zrange(k.syncDue, "-inf", now, {
            byScore: true,
            offset: 0,
            count: limit,
          }),
    countScheduled: () => redis.zcard(k.syncDue),

    async acquireLock(name, ttlMs) {
      const token = newToken();
      const set = await redis.set(k.lock(name), token, { nx: true, px: ttlMs });
      return set === "OK" ? token : null;
    },
    async releaseLock(name, token) {
      // Compare-then-delete is not atomic; the TTL bounds the race window.
      if ((await redis.get(k.lock(name))) === token) await del(k.lock(name));
    },
    async claim(claimKey, ttlSeconds) {
      return (
        (await redis.set(k.claim(claimKey), "1", {
          nx: true,
          ex: ttlSeconds,
        })) === "OK"
      );
    },

    async releaseClaims(keys) {
      await del(...keys.map(k.claim));
    },

    async putRetry(job, at) {
      await setJson(k.retry(job.id), job, { ex: RETRY_JOB_TTL_S });
      await redis.zadd(k.retryDue, { score: at, member: job.id });
    },
    getRetry: (jobId) => getJson<RetryJob>(k.retry(jobId)),
    async dueRetries(now, limit) {
      // Healthy due jobs stay at the front of the due range, so each page
      // starts after them. Failed jobs are re-scored past the TTL (their job
      // key stays for getRetry and deleteAccountData) and stale members are
      // pruned, so every page makes progress. Bounded at 5 pages per call.
      const healthy: RetryJob[] = [];
      for (let page = 0; page < 5 && healthy.length < limit; page++) {
        const ids = await redis.zrange(k.retryDue, "-inf", now, {
          byScore: true,
          offset: healthy.length,
          count: limit - healthy.length,
        });
        if (ids.length === 0) break;
        const jobs = await mgetJson<RetryJob>(ids.map(k.retry));
        const stale: string[] = [];
        for (const [i, id] of ids.entries()) {
          const job = jobs[i];
          if (job === null || job === undefined) stale.push(id);
          else if (job.failed) {
            await redis.zadd(k.retryDue, {
              score: now + RETRY_JOB_TTL_S * 1000,
              member: id,
            });
          } else healthy.push(job);
        }
        if (stale.length > 0) await redis.zrem(k.retryDue, ...stale);
      }
      return healthy;
    },
    async deleteRetry(jobId) {
      await redis.zrem(k.retryDue, jobId);
      await del(k.retry(jobId));
    },

    async upsertActivity(id, entry) {
      await setJson(k.act(id, entry.groupKey), entry, { ex: ACTIVITY_TTL_S });
      await redis.zadd(k.acts(id), {
        score: entry.publishedAt,
        member: entry.groupKey,
      });
      await trimActivityIndex(id);
      // Each record expires a window after its own last write. This is the
      // latest write, so the index lasts as long as any record it lists, and
      // goes a window after writes stop.
      await redis.expire(k.acts(id), ACTIVITY_TTL_S);
    },
    getActivity: (id, groupKey) => getJson<ActivityEntry>(k.act(id, groupKey)),
    listActivity: (id, limit) =>
      listIndexed<ActivityEntry>(k.acts(id), (g) => k.act(id, g), limit),

    async putDraft(d) {
      await setJson(k.draft(d.token), d, { ex: DRAFT_TTL_S });
      await redis.zadd(k.drafts(d.accountId), {
        score: d.createdAt,
        member: d.token,
      });
      // A draft is written once, when it's made, so its score is its write
      // time and the index can drop members by score alone.
      await redis.zremrangebyscore(
        k.drafts(d.accountId),
        "-inf",
        Date.now() - DRAFT_TTL_S * 1000,
      );
      await redis.expire(k.drafts(d.accountId), DRAFT_TTL_S);
    },
    getDraft: (token) => getJson<RedditDraft>(k.draft(token)),
    listDrafts: (id, limit) =>
      listIndexed<RedditDraft>(k.drafts(id), k.draft, limit),

    async raiseAlertOnce(id, alert) {
      const first = await redis.set(k.alertKey(id, alert.key), "1", {
        nx: true,
        ex: ALERT_DEDUPE_TTL_S,
      });
      if (first !== "OK") return false;
      const existing = (await getJson<Alert[]>(k.alerts(id))) ?? [];
      await setJson(k.alerts(id), [alert, ...existing].slice(0, ALERTS_KEPT));
      return true;
    },
    async clearAlertKey(id, alertKey) {
      await del(k.alertKey(id, alertKey));
      // The problem is over, so its alerts leave the list too.
      const all = (await getJson<Alert[]>(k.alerts(id))) ?? [];
      const kept = all.filter((a) => a.key !== alertKey);
      if (kept.length < all.length) await setJson(k.alerts(id), kept);
    },
    async listAlerts(id, limit) {
      const all = (await getJson<Alert[]>(k.alerts(id))) ?? [];
      return all.slice(0, Math.min(limit, ALERTS_KEPT));
    },

    putRateLimit: (s) => setJson(k.rateLimit, s),
    getRateLimit: () => getJson<RateLimitSnapshot>(k.rateLimit),

    async countApiCall(id, day) {
      const n = await redis.incr(k.calls(id, day));
      if (n === 1) await redis.expire(k.calls(id, day), CALLS_TTL_S);
      return n;
    },
    async getApiCalls(id, day) {
      const raw = await redis.get(k.calls(id, day));
      return raw === null ? 0 : Number(raw);
    },

    async deleteAccountData(id) {
      const destIds = await redis.smembers(k.dests(id));
      const routeIds = await redis.smembers(k.routes(id));
      const groupKeys = await redis.zrange(k.acts(id), 0, -1);
      const tokens = await redis.zrange(k.drafts(id), 0, -1);

      // Jobs for destinations removed earlier are this account's too.
      const dueIds = await redis.zrange(k.retryDue, 0, -1);
      const jobs = await mgetJson<RetryJob>(dueIds.map(k.retry));
      const ownJobIds = dueIds.filter((_, i) => {
        const job = jobs[i];
        return (
          job !== null &&
          job !== undefined &&
          (job.accountId === id || destIds.includes(job.destinationId))
        );
      });
      if (ownJobIds.length > 0) await redis.zrem(k.retryDue, ...ownJobIds);
      await redis.zrem(k.syncDue, id);

      // Alert dedupe keys (ferry:alertkey:*), daily call counters
      // (ferry:calls:*) and Telegram link codes (ferry:tglink:*) are left to
      // expire on their own TTLs: they hold only IDs and counts, and cannot
      // be enumerated without a key scan.
      await del(
        k.account(id),
        k.tokens(id),
        k.channels(id),
        k.sync(id),
        k.routes(id),
        k.dests(id),
        k.acts(id),
        k.drafts(id),
        k.alerts(id),
        ...routeIds.map(k.route),
        ...destIds.map(k.dest),
        ...groupKeys.map((g) => k.act(id, g)),
        ...tokens.map(k.draft),
        ...ownJobIds.map(k.retry),
      );
    },
  };
}
