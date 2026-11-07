import { randomBytes } from "node:crypto";
import { vi } from "vitest";
import { createFakeRedis } from "../store/fake-redis";
import { createStore } from "../store/store";
import type { DeliverDeps } from "./deliver";
import type {
  Account,
  DeliveryOutcome,
  DiscordDestination,
  MirrorPost,
  RedditDestination,
  Route,
} from "../types";

export const NOW = 1_000_000;

export const account = (over: Partial<Account> = {}): Account => ({
  accountId: "acct",
  name: "me",
  timezone: null,
  organizationIds: ["org"],
  status: "active",
  notifyDestinationId: null,
  createdAt: 1,
  ...over,
});
export const discordDest = (
  id: string,
  over: Partial<DiscordDestination> = {},
): DiscordDestination => ({
  id,
  accountId: "acct",
  kind: "discord",
  label: `Chan ${id}`,
  webhookId: `wh-${id}`,
  webhookToken: `tok-${id}`,
  guildId: "guild",
  channelId: "chan",
  status: "active",
  createdAt: 1,
  ...over,
});
export const redditDest = (id: string): RedditDestination => ({
  id,
  accountId: "acct",
  kind: "reddit",
  label: "Reddit",
  subreddit: "test",
  status: "active",
  createdAt: 1,
});
export const route = (id: string, destinationId: string): Route => ({
  id,
  accountId: "acct",
  channelIds: ["ch"],
  tagNames: [],
  destinationId,
  activeSince: 0,
  paused: false,
  createdAt: 1,
});
export const mirror = (over: Partial<MirrorPost> = {}): MirrorPost => ({
  groupKey: "g1",
  postIds: ["p1"],
  text: "Hello world",
  threadTexts: [],
  images: [],
  video: null,
  link: null,
  permalinks: [],
  source: { channelId: "ch", service: "bluesky", name: "me", avatar: "" },
  publishedAt: 500,
  ...over,
});

export type SendCall = Parameters<DeliverDeps["sendDiscord"]>[0];
type Script = DeliveryOutcome | Error;

/** Fake adapter: records calls, plays scripted outcomes in order, then succeeds. */
export function makeDeps(script: Script[] = []) {
  const redis = createFakeRedis();
  const store = createStore(redis, randomBytes(32));
  const calls: SendCall[] = [];
  const queue = [...script];
  let tokenN = 0;
  const deps: DeliverDeps = {
    store,
    now: () => NOW,
    baseUrl: "https://ferry.test",
    newToken: () => `tok${++tokenN}`,
    sendDiscord: vi.fn(async (a: SendCall) => {
      calls.push(a);
      const next = queue.shift();
      if (next instanceof Error) throw next;
      return (
        next ?? {
          ok: true as const,
          url: `https://discord.test/m${calls.length}`,
        }
      );
    }),
  };
  return { deps, store, calls, redis };
}
