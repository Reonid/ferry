import { vi } from "vitest";
import { BufferError } from "../buffer/client";
import {
  NOW,
  account,
  discordDest,
  makeDeps,
  route,
} from "../delivery/test-support";
import type { Channel, RateLimitSnapshot } from "../types";
import type { SyncDeps } from "./runner";

export { NOW };

export const channel = (over: Partial<Channel> = {}): Channel => ({
  id: "ch",
  organizationId: "org",
  service: "bluesky",
  name: "me",
  displayName: "Ferry Dev",
  avatar: "",
  isDisconnected: false,
  isQueuePaused: false,
  isLocked: false,
  ...over,
});

export const rawPost = (over: Record<string, unknown> = {}) => ({
  id: "p1",
  status: "sent",
  text: "Hello world",
  dueAt: new Date(NOW - 60_000).toISOString(),
  sentAt: new Date(NOW - 60_000).toISOString(),
  channelId: "ch",
  channelService: "bluesky",
  contentItemId: "ci1",
  externalLink: "https://bsky.test/p1",
  tags: [],
  ...over,
});

export interface FakeData {
  posts?: unknown[];
  upcoming?: unknown[];
  channels?: Channel[];
  rateLimit?: RateLimitSnapshot | null;
}

/** Fake Buffer: answers one org under the r0/u0/c0 aliases, or throws the scripted error. */
export function makeSyncDeps(data: FakeData = {}, failWith?: Error) {
  const ctx = makeDeps();
  const buffer = vi.fn<SyncDeps["buffer"]>(async () => {
    if (failWith) throw failWith;
    return {
      data: {
        r0: { edges: (data.posts ?? []).map((node) => ({ node })) },
        u0: { edges: (data.upcoming ?? []).map((node) => ({ node })) },
        c0: data.channels ?? [channel()],
      },
      rateLimit: data.rateLimit ?? null,
    };
  });
  const deps: SyncDeps = {
    ...ctx.deps,
    buffer,
    getAccessToken: async () => "access-token",
    jitterMs: () => 0,
  };
  return { ...ctx, deps, buffer };
}

export async function seed(
  store: SyncDeps["store"],
  opts: { activeSince?: number; channels?: Channel[] } = {},
) {
  await store.putAccount(account());
  await store.putDestination(discordDest("d1"));
  await store.putRoute({
    ...route("r1", "d1"),
    activeSince: opts.activeSince ?? 0,
  });
  await store.putChannels("acct", opts.channels ?? [channel()]);
}

export { BufferError };
