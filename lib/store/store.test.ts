import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import {
  ACTIVITY_TTL_S,
  ALERT_DEDUPE_TTL_S,
  DRAFT_TTL_S,
  TELEGRAM_LINK_TTL_S,
} from "@/lib/constants";
import { createFakeRedis } from "./fake-redis";
import type { RedisLike } from "./redis-like";
import { createStore, type Store } from "./store";
import type {
  Account,
  ActivityEntry,
  Alert,
  DiscordDestination,
  RedditDestination,
  RedditDraft,
  RetryJob,
  Route,
  TelegramDestination,
  TelegramLink,
} from "@/lib/types";

const DAY = 24 * 60 * 60 * 1000;

let redis: RedisLike;
let store: Store;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
  redis = createFakeRedis();
  store = createStore(redis, randomBytes(32));
});
afterEach(() => vi.useRealTimers());

const account = (id: string): Account => ({
  accountId: id,
  name: id,
  timezone: null,
  organizationIds: ["org"],
  status: "active",
  notifyDestinationId: null,
  createdAt: 1,
});
const discord = (id: string, accountId: string): DiscordDestination => ({
  id,
  accountId,
  kind: "discord",
  label: "Discord",
  webhookId: "wh1",
  webhookToken: `secret-webhook-token-${id}`,
  guildId: "g",
  channelId: "c",
  status: "active",
  createdAt: 1,
});
const reddit = (id: string, accountId: string): RedditDestination => ({
  id,
  accountId,
  kind: "reddit",
  label: "Reddit",
  subreddit: "test",
  status: "active",
  createdAt: 2,
});
const route = (
  id: string,
  accountId: string,
  destinationId: string,
): Route => ({
  id,
  accountId,
  channelIds: ["ch"],
  tagNames: [],
  destinationId,
  activeSince: 0,
  paused: false,
  createdAt: 1,
});
const entry = (groupKey: string, publishedAt: number): ActivityEntry => ({
  groupKey,
  excerpt: groupKey,
  source: { service: "bluesky", name: "me" },
  publishedAt,
  deliveries: [],
});
const draft = (token: string, accountId: string): RedditDraft => ({
  token,
  accountId,
  subreddit: "test",
  title: "t",
  body: "b",
  kind: "self",
  url: null,
  images: [],
  submitUrl: "https://reddit.com/submit",
  createdAt: 5,
});
const alert = (key: string, at = 1): Alert => ({
  key,
  message: key,
  supportUrl: null,
  at,
});
const job = (
  id: string,
  accountId: string,
  destinationId: string,
): RetryJob => ({
  id,
  accountId,
  destinationId,
  groupKey: "g",
  mirror: {
    groupKey: "g",
    postIds: ["p"],
    text: "hi",
    threadTexts: [],
    images: [],
    video: null,
    link: null,
    permalinks: [],
    source: { channelId: "ch", service: "bluesky", name: "me", avatar: "" },
    publishedAt: 1,
  },
  attempts: 0,
  sentCount: 0,
  failed: false,
});

describe("claim", () => {
  it("claims once until the ttl passes", async () => {
    expect(await store.claim("k", 60)).toBe(true);
    expect(await store.claim("k", 60)).toBe(false);
    vi.advanceTimersByTime(61_000);
    expect(await store.claim("k", 60)).toBe(true);
  });
});

describe("sync schedule", () => {
  it("returns due accounts in time order up to the limit", async () => {
    await store.scheduleSync("a", 300);
    await store.scheduleSync("b", 100);
    await store.scheduleSync("c", 200);
    await store.scheduleSync("d", 900);
    expect(await store.dueAccounts(500, 2)).toEqual(["b", "c"]);
    expect(await store.countScheduled()).toBe(4);
    await store.unscheduleSync("b");
    expect(await store.dueAccounts(500, 5)).toEqual(["c", "a"]);
  });

  it("returns defaults when no sync state exists", async () => {
    expect(await store.getSyncState("nobody")).toEqual({
      checkpoint: null,
      overdueAttempts: 0,
      lastSyncAt: null,
      nextRunAt: null,
      liveUntil: null,
      lastSendLatestAt: null,
      retryAt: null,
      failureCount: 0,
    });
  });

  it("fills fields a saved sync state predates", async () => {
    await redis.set(
      "ferry:sync:old",
      JSON.stringify({
        checkpoint: 5,
        overdueAttempts: 1,
        lastSyncAt: 5,
        nextRunAt: 9,
        liveUntil: null,
        lastSendLatestAt: null,
        retryAt: null,
      }),
    );
    expect(await store.getSyncState("old")).toMatchObject({
      checkpoint: 5,
      nextRunAt: 9,
      failureCount: 0,
    });
  });
});

describe("encryption at rest", () => {
  it("encrypts tokens at rest", async () => {
    const t = {
      accessToken: "access-abc-123",
      refreshToken: "r",
      expiresAt: 5,
    };
    await store.putTokens("acct", t);
    const raw = await redis.get("ferry:tokens:acct");
    expect(raw).not.toBeNull();
    expect(raw).not.toContain("access-abc-123");
    expect(await store.getTokens("acct")).toEqual(t);
    expect(await store.getTokens("other")).toBeNull();
  });

  it("encrypts webhook tokens at rest", async () => {
    const d = discord("d1", "acct");
    await store.putDestination(d);
    const raw = await redis.get("ferry:dest:d1");
    expect(raw).not.toContain(d.webhookToken);
    expect(await store.getDestination("d1")).toEqual(d);
    await store.putDestination(reddit("d2", "acct"));
    expect(await store.listDestinations("acct")).toEqual([
      d,
      reddit("d2", "acct"),
    ]);
  });
});

describe("routes and destinations", () => {
  it("lists, gets and deletes", async () => {
    await store.putRoute(route("r1", "acct", "d1"));
    expect(await store.listRoutes("acct")).toHaveLength(1);
    expect(await store.getRoute("r1")).toEqual(route("r1", "acct", "d1"));
    await store.deleteRoute("acct", "r1");
    expect(await store.listRoutes("acct")).toEqual([]);
    expect(await store.getRoute("r1")).toBeNull();
    await store.putDestination(reddit("d2", "acct"));
    await store.deleteDestination("acct", "d2");
    expect(await store.listDestinations("acct")).toEqual([]);
  });
});

describe("releaseClaims", () => {
  it("frees claimed keys and accepts an empty list", async () => {
    expect(await store.claim("a", 100)).toBe(true);
    expect(await store.claim("b", 100)).toBe(true);
    await store.releaseClaims([]);
    await store.releaseClaims(["a", "b"]);
    expect(await store.claim("a", 100)).toBe(true);
    expect(await store.claim("b", 100)).toBe(true);
  });
});

describe("activity", () => {
  it("gets one entry by group key or null", async () => {
    expect(await store.getActivity("acct", "g")).toBeNull();
    await store.upsertActivity("acct", entry("g", 100));
    expect(await store.getActivity("acct", "g")).toEqual(entry("g", 100));
  });

  it("lists activity newest first and skips expired entries", async () => {
    await store.upsertActivity("acct", entry("old", 100));
    await store.upsertActivity("acct", entry("new", 300));
    expect(
      (await store.listActivity("acct", 10)).map((e) => e.groupKey),
    ).toEqual(["new", "old"]);
    expect(await store.listActivity("acct", 1)).toHaveLength(1);

    await redis.del("ferry:act:acct:new");
    expect(
      (await store.listActivity("acct", 10)).map((e) => e.groupKey),
    ).toEqual(["old"]);
    expect(await redis.zcard("ferry:acts:acct")).toBe(1);
  });

  it("expires entries after the ttl", async () => {
    await store.upsertActivity("acct", entry("g", 100));
    vi.advanceTimersByTime(31 * 24 * 60 * 60 * 1000);
    expect(await store.listActivity("acct", 10)).toEqual([]);
  });

  it("trims activity index entries older than the activity window", async () => {
    vi.setSystemTime(100 * DAY);
    await store.upsertActivity("acct", entry("old", 100 * DAY));
    vi.setSystemTime(120 * DAY);
    await store.upsertActivity("acct", entry("recent", 120 * DAY));
    // "old" is past the window and its record has expired.
    vi.setSystemTime(131 * DAY);
    await store.upsertActivity("acct", entry("new", 131 * DAY));
    expect(await redis.zrange("ferry:acts:acct", 0, -1)).toEqual([
      "recent",
      "new",
    ]);
  });

  it("expires the activity index when nothing is written for the window", async () => {
    await store.upsertActivity("acct", entry("g", Date.now()));
    vi.advanceTimersByTime(ACTIVITY_TTL_S * 1000 - 1000);
    expect(await redis.zcard("ferry:acts:acct")).toBe(1);
    vi.advanceTimersByTime(1000);
    expect(await redis.zcard("ferry:acts:acct")).toBe(0);
  });

  it("keeps a fresh entry for an old post listed and deletable", async () => {
    // A test send or a catch-up sync can record a post published long ago.
    vi.setSystemTime(200 * DAY);
    await store.upsertActivity("acct", entry("old-post", 100 * DAY));
    await store.upsertActivity("acct", entry("other", 200 * DAY));
    expect(
      (await store.listActivity("acct", 10)).map((e) => e.groupKey),
    ).toEqual(["other", "old-post"]);

    await store.deleteAccountData("acct");
    expect(await store.getActivity("acct", "old-post")).toBeNull();
  });

  it("drops an old post's entry once its record has expired", async () => {
    vi.setSystemTime(200 * DAY);
    await store.upsertActivity("acct", entry("old-post", 100 * DAY));
    vi.setSystemTime(231 * DAY);
    await store.upsertActivity("acct", entry("later", 231 * DAY));
    expect(await redis.zrange("ferry:acts:acct", 0, -1)).toEqual(["later"]);
  });
});

describe("drafts", () => {
  it("stores, gets and lists newest first", async () => {
    await store.putDraft({ ...draft("t1", "acct"), createdAt: 1 });
    await store.putDraft({ ...draft("t2", "acct"), createdAt: 2 });
    expect(await store.getDraft("t1")).not.toBeNull();
    expect((await store.listDrafts("acct", 10)).map((d) => d.token)).toEqual([
      "t2",
      "t1",
    ]);
    vi.advanceTimersByTime(8 * 24 * 60 * 60 * 1000);
    expect(await store.listDrafts("acct", 10)).toEqual([]);
    expect(await store.getDraft("t1")).toBeNull();
  });

  it("trims and expires the drafts index the same way", async () => {
    vi.setSystemTime(100 * DAY);
    await store.putDraft({ ...draft("old", "acct"), createdAt: 100 * DAY });
    vi.setSystemTime(104 * DAY);
    await store.putDraft({ ...draft("recent", "acct"), createdAt: 104 * DAY });
    vi.setSystemTime(108 * DAY);
    await store.putDraft({ ...draft("new", "acct"), createdAt: 108 * DAY });
    expect(await redis.zrange("ferry:drafts:acct", 0, -1)).toEqual([
      "recent",
      "new",
    ]);

    // With no further drafts, the whole index goes a window after the last.
    vi.advanceTimersByTime(DRAFT_TTL_S * 1000 - 1000);
    expect(await redis.zcard("ferry:drafts:acct")).toBe(2);
    vi.advanceTimersByTime(1000);
    expect(await redis.zcard("ferry:drafts:acct")).toBe(0);
  });
});

describe("fake redis zremrangebyscore", () => {
  it("removes members within the score bounds, -inf included", async () => {
    for (const [member, score] of [
      ["a", 1],
      ["b", 5],
      ["c", 10],
    ] as const)
      await redis.zadd("z", { score, member });

    expect(await redis.zremrangebyscore("z", 2, 5)).toBe(1);
    expect(await redis.zrange("z", 0, -1)).toEqual(["a", "c"]);
    expect(await redis.zremrangebyscore("z", "-inf", 9)).toBe(1);
    expect(await redis.zrange("z", 0, -1)).toEqual(["c"]);
    expect(await redis.zremrangebyscore("z", "-inf", "+inf")).toBe(1);
    expect(await redis.zcard("z")).toBe(0);
    expect(await redis.zremrangebyscore("missing", "-inf", 0)).toBe(0);
  });
});

describe("alerts", () => {
  it("raises an alert once until its key is cleared", async () => {
    expect(await store.raiseAlertOnce("acct", alert("k"))).toBe(true);
    expect(await store.raiseAlertOnce("acct", alert("k"))).toBe(false);
    expect(await store.listAlerts("acct", 10)).toHaveLength(1);
    await store.clearAlertKey("acct", "k");
    expect(await store.raiseAlertOnce("acct", alert("k"))).toBe(true);
    expect(await store.listAlerts("acct", 10)).toHaveLength(1);
  });

  it("clearing an alert key removes it from the list", async () => {
    await store.raiseAlertOnce("acct", alert("k", 1));
    // Once the marker expires, a lasting problem is listed a second time.
    vi.advanceTimersByTime(ALERT_DEDUPE_TTL_S * 1000);
    await store.raiseAlertOnce("acct", alert("other", 2));
    await store.raiseAlertOnce("acct", alert("k", 3));
    await store.raiseAlertOnce("b", alert("k", 4));
    expect((await store.listAlerts("acct", 10)).map((a) => a.key)).toEqual([
      "k",
      "other",
      "k",
    ]);

    await store.clearAlertKey("acct", "k");
    expect((await store.listAlerts("acct", 10)).map((a) => a.key)).toEqual([
      "other",
    ]);
    expect((await store.listAlerts("b", 10)).map((a) => a.key)).toEqual(["k"]);
    expect(await store.raiseAlertOnce("acct", alert("k", 5))).toBe(true);

    await store.clearAlertKey("acct", "missing");
    expect(await store.listAlerts("acct", 10)).toHaveLength(2);
  });

  it("keeps only the newest 20 alerts", async () => {
    for (let i = 0; i < 25; i++) {
      await store.raiseAlertOnce("acct", alert(`k${i}`, i));
    }
    const alerts = await store.listAlerts("acct", 50);
    expect(alerts).toHaveLength(20);
    expect(alerts[0]?.key).toBe("k24");
    expect(alerts[19]?.key).toBe("k5");
    expect(await store.listAlerts("acct", 3)).toHaveLength(3);
  });
});

describe("retries", () => {
  it("doesn't let failed jobs starve due ones", async () => {
    for (let i = 0; i < 3; i++) {
      await store.putRetry({ ...job(`f${i}`, "acct", "d1"), failed: true }, i);
    }
    await store.putRetry(job("ok", "acct", "d1"), 100);
    expect((await store.dueRetries(1000, 3)).map((j) => j.id)).toEqual(["ok"]);
    expect(await redis.zrange("ferry:retry:due", 0, -1)).toEqual([
      "ok",
      "f0",
      "f1",
      "f2",
    ]);
    expect(
      await redis.zrange("ferry:retry:due", "-inf", 1000, {
        byScore: true,
        offset: 0,
        count: 10,
      }),
    ).toEqual(["ok"]);
    expect((await store.getRetry("f0"))?.failed).toBe(true);
  });

  it("skips failed retry jobs", async () => {
    await store.putRetry(job("ok", "acct", "d1"), 100);
    await store.putRetry({ ...job("bad", "acct", "d1"), failed: true }, 50);
    await store.putRetry(job("later", "acct", "d1"), 5000);
    expect((await store.dueRetries(1000, 10)).map((j) => j.id)).toEqual(["ok"]);
    expect(await store.getRetry("bad")).not.toBeNull();
    await store.deleteRetry("ok");
    expect(await store.getRetry("ok")).toBeNull();
    expect(await store.dueRetries(1000, 10)).toEqual([]);
  });
});

describe("locks", () => {
  it("locks until released or expired", async () => {
    const token = await store.acquireLock("sync", 10_000);
    expect(token).toEqual(expect.any(String));
    expect(await store.acquireLock("sync", 10_000)).toBeNull();

    await store.releaseLock("sync", "wrong");
    expect(await store.acquireLock("sync", 10_000)).toBeNull();

    await store.releaseLock("sync", token as string);
    const second = await store.acquireLock("sync", 10_000);
    expect(second).toEqual(expect.any(String));

    vi.advanceTimersByTime(10_001);
    expect(await store.acquireLock("sync", 10_000)).toEqual(expect.any(String));
  });
});

describe("api calls and rate limit", () => {
  it("counts calls per day", async () => {
    expect(await store.getApiCalls("acct", "2026-11-05")).toBe(0);
    expect(await store.countApiCall("acct", "2026-11-05")).toBe(1);
    expect(await store.countApiCall("acct", "2026-11-05")).toBe(2);
    expect(await store.getApiCalls("acct", "2026-11-05")).toBe(2);
    vi.advanceTimersByTime(3 * 24 * 60 * 60 * 1000);
    expect(await store.getApiCalls("acct", "2026-11-05")).toBe(0);
  });

  it("round-trips the rate limit snapshot", async () => {
    expect(await store.getRateLimit()).toBeNull();
    const s = {
      observedAt: 1,
      windows: [{ name: "w", remaining: 3, resetSeconds: 9 }],
    };
    await store.putRateLimit(s);
    expect(await store.getRateLimit()).toEqual(s);
  });
});

describe("deleteAccountData", () => {
  async function seed(id: string) {
    await store.putAccount(account(id));
    await store.putTokens(id, {
      accessToken: "a",
      refreshToken: "r",
      expiresAt: 1,
    });
    await store.putChannels(id, []);
    await store.putDestination(discord(`${id}-d`, id));
    await store.putRoute(route(`${id}-r`, id, `${id}-d`));
    await store.putSyncState(id, {
      ...(await store.getSyncState(id)),
      checkpoint: 7,
    });
    await store.scheduleSync(id, 10);
    await store.putRetry(job(`${id}-j`, id, `${id}-d`), 10);
    await store.upsertActivity(id, entry(`${id}-g`, 10));
    await store.putDraft(draft(`${id}-t`, id));
    await store.raiseAlertOnce(id, alert("k"));
    await store.countApiCall(id, "2026-11-05");
  }

  it("deletes one account's data and nothing else", async () => {
    await seed("a");
    await seed("b");
    await store.deleteAccountData("a");

    expect(await store.getAccount("a")).toBeNull();
    expect(await store.getTokens("a")).toBeNull();
    expect(await store.getChannels("a")).toEqual([]);
    expect(await store.listDestinations("a")).toEqual([]);
    expect(await store.getDestination("a-d")).toBeNull();
    expect(await store.listRoutes("a")).toEqual([]);
    expect(await store.getRoute("a-r")).toBeNull();
    expect((await store.getSyncState("a")).checkpoint).toBeNull();
    expect(await store.getRetry("a-j")).toBeNull();
    expect(await store.listActivity("a", 10)).toEqual([]);
    expect(await store.getDraft("a-t")).toBeNull();
    expect(await store.listDrafts("a", 10)).toEqual([]);
    expect(await store.listAlerts("a", 10)).toEqual([]);
    expect(await store.dueAccounts(100, 10)).toEqual(["b"]);

    expect(await store.getAccount("b")).not.toBeNull();
    expect(await store.getTokens("b")).not.toBeNull();
    expect(await store.getChannels("b")).toEqual([]);
    expect(await store.listDestinations("b")).toHaveLength(1);
    expect(await store.listRoutes("b")).toHaveLength(1);
    expect((await store.getSyncState("b")).checkpoint).toBe(7);
    expect(await store.getRetry("b-j")).not.toBeNull();
    expect((await store.dueRetries(100, 10)).map((j) => j.id)).toEqual(["b-j"]);
    expect(await store.listActivity("b", 10)).toHaveLength(1);
    expect(await store.getDraft("b-t")).not.toBeNull();
    expect(await store.listDrafts("b", 10)).toHaveLength(1);
    expect(await store.listAlerts("b", 10)).toHaveLength(1);
    expect(await store.getApiCalls("b", "2026-11-05")).toBe(1);
  });

  it("deletes retry jobs for an already-removed destination", async () => {
    await seed("a");
    await seed("b");
    await store.putRetry(job("a-gone", "a", "removed"), 10);
    await store.putRetry(
      { ...job("a-failed", "a", "removed"), failed: true },
      10,
    );
    await store.putRetry(job("b-gone", "b", "removed"), 10);
    await store.deleteAccountData("a");

    expect(await store.getRetry("a-gone")).toBeNull();
    expect(await store.getRetry("a-failed")).toBeNull();
    expect(await redis.zrange("ferry:retry:due", 0, -1)).toEqual([
      "b-gone",
      "b-j",
    ]);
    expect(await store.getRetry("b-gone")).not.toBeNull();
  });
});

describe("telegram", () => {
  const tgDest: TelegramDestination = {
    id: "t1",
    accountId: "acct",
    kind: "telegram",
    label: "My channel",
    chatId: "-1001234567890",
    chatType: "channel",
    username: "mychannel",
    status: "active",
    createdAt: 5,
  };
  const link: TelegramLink = {
    accountId: "acct",
    purpose: "chat",
    createdAt: 1_000_000,
    destinationId: null,
  };

  it("round-trips a Telegram destination", async () => {
    await store.putDestination(tgDest);
    expect(await store.getDestination("t1")).toEqual(tgDest);
    expect(await store.listDestinations("acct")).toEqual([tgDest]);
  });

  it("expires a Telegram link code after 15 minutes", async () => {
    await store.putTelegramLink("abc", link);
    expect(await store.getTelegramLink("abc")).toEqual(link);
    vi.advanceTimersByTime(TELEGRAM_LINK_TTL_S * 1000 - 1000);
    expect(await store.getTelegramLink("abc")).toEqual(link);
    vi.advanceTimersByTime(1000);
    expect(await store.getTelegramLink("abc")).toBeNull();
    expect(TELEGRAM_LINK_TTL_S).toBe(15 * 60);
  });

  it("stores the update offset", async () => {
    expect(await store.getTelegramOffset()).toBe(0);
    await store.putTelegramOffset(42);
    expect(await store.getTelegramOffset()).toBe(42);
    expect(await redis.get("ferry:tg:offset")).toBe("42");
  });
});
