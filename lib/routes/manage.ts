import { BufferError } from "../buffer/client";
import { mapAccount, mapChannel, mapPost } from "../buffer/map";
import {
  ACCOUNT_QUERY,
  CHANNELS_QUERY,
  LATEST_SENT_QUERY,
} from "../buffer/queries";
import { TokenBusyError } from "../buffer/tokens";
import { MAX_ROUTES, SEND_LATEST_COOLDOWN_MS } from "../constants";
import { newId } from "../crypto";
import { deliverToDestination } from "../delivery/deliver";
import { retryFailedJob } from "../delivery/retries";
import { normalizeSubreddit } from "../destinations/reddit/subreddit";
import { toMirrorPost } from "../mirror/to-mirror";
import { routeTakesTags } from "../routing/match";
import type { Store } from "../store/store";
import type { SyncDeps } from "../sync/runner";
import { dayKey } from "../time";
import type {
  Account,
  Channel,
  Destination,
  DiscordDestination,
  Post,
  RedditDestination,
  Route,
  SyncState,
} from "../types";

export type ActionResult =
  { ok: true; message?: string } | { ok: false; error: string };

const fail = (error: string): ActionResult => ({ ok: false, error });
const MAX_TAGS = 10;
const MAX_LABEL = 60;
const RECONNECT = "Reconnect this destination first.";
const REFRESH_CHANNELS = "Refresh your channels and try again.";
const SIGN_IN_AGAIN = "Buffer disconnected Ferry. Sign in again.";
const RATE_LIMITED =
  "Ferry is waiting on Buffer's rate limit. Try again in a few minutes.";

export function validateRouteInput(args: {
  channelIds: string[];
  destinationId: string;
  tagNames: string[];
  channels: Channel[];
  destinations: Destination[];
}): { ok: true; tagNames: string[] } | { ok: false; error: string } {
  if (args.channelIds.length === 0)
    return { ok: false, error: "Pick at least one channel." };
  const known = new Set(args.channels.map((c) => c.id));
  if (!args.channelIds.every((id) => known.has(id)))
    return { ok: false, error: "Pick channels from your Buffer account." };
  const destination = args.destinations.find(
    (d) => d.id === args.destinationId,
  );
  if (!destination)
    return { ok: false, error: "Pick one of your destinations." };
  if (destination.status !== "active") return { ok: false, error: RECONNECT };
  if (destination.kind === "telegram" && destination.chatType === "private")
    return {
      ok: false,
      error:
        "Pick a channel or group for posts. Direct messages are for alerts only.",
    };
  const tagNames = [
    ...new Set(
      args.tagNames.map((t) => t.trim().toLowerCase()).filter((t) => t !== ""),
    ),
  ].slice(0, MAX_TAGS);
  return { ok: true, tagNames };
}

/** Makes the account due for a check now, keeping nextRunAt in step. */
export async function syncNow(
  store: Store,
  accountId: string,
  now: number,
): Promise<void> {
  await store.scheduleSync(accountId, now);
  const state = await store.getSyncState(accountId);
  await store.putSyncState(accountId, { ...state, nextRunAt: now });
}

async function ownRoute(
  store: Store,
  accountId: string,
  routeId: string,
): Promise<Route | null> {
  const route = await store.getRoute(routeId);
  return route && route.accountId === accountId ? route : null;
}

async function ownDestination(
  store: Store,
  accountId: string,
  destId: string,
): Promise<Destination | null> {
  const dest = await store.getDestination(destId);
  return dest && dest.accountId === accountId ? dest : null;
}

const sameSet = (a: string[], b: string[]) =>
  a.length === b.length && a.every((x) => b.includes(x));

/**
 * Adds a route, unless one with the same channels, destination and tags
 * exists. A post crosses once per destination anyway; this keeps a
 * repeated click, or an AI app's repeated call, from adding clutter.
 */
export async function createRoute(
  store: Store,
  accountId: string,
  input: { channelIds: string[]; destinationId: string; tagNames: string[] },
  now: number,
): Promise<
  { ok: true; message: string; routeId: string } | { ok: false; error: string }
> {
  const checked = validateRouteInput({
    ...input,
    channels: await store.getChannels(accountId),
    destinations: await store.listDestinations(accountId),
  });
  if (!checked.ok) return { ok: false, error: checked.error };
  const channelIds = [...new Set(input.channelIds)];
  const routes = await store.listRoutes(accountId);
  const same = routes.find(
    (r) =>
      r.destinationId === input.destinationId &&
      sameSet(r.channelIds, channelIds) &&
      sameSet(r.tagNames, checked.tagNames),
  );
  if (same)
    return {
      ok: false,
      error: same.paused
        ? "That route already exists, paused. Resume it instead."
        : "That route already exists.",
    };
  if (routes.length >= MAX_ROUTES)
    return {
      ok: false,
      error: `You have ${MAX_ROUTES} routes, the most Ferry keeps. Delete one first.`,
    };
  const id = newId();
  await store.putRoute({
    id,
    accountId,
    channelIds,
    tagNames: checked.tagNames,
    destinationId: input.destinationId,
    activeSince: now,
    paused: false,
    createdAt: now,
  });
  await syncNow(store, accountId, now);
  return { ok: true, message: "Route added.", routeId: id };
}

export async function deleteRoute(
  store: Store,
  accountId: string,
  routeId: string,
): Promise<ActionResult> {
  if (!(await ownRoute(store, accountId, routeId)))
    return fail("That route no longer exists.");
  await store.deleteRoute(accountId, routeId);
  return { ok: true };
}

export async function setRoutePaused(
  store: Store,
  accountId: string,
  routeId: string,
  paused: boolean,
  now: number,
): Promise<ActionResult> {
  const route = await ownRoute(store, accountId, routeId);
  if (!route) return fail("That route no longer exists.");
  // A resumed route starts afresh: posts from while it was paused stay put.
  const resumed = route.paused && !paused;
  const next = resumed
    ? { ...route, paused, activeSince: now }
    : { ...route, paused };
  // Deleted since it was read, by the owner or Delete my data: it stays gone.
  if (!(await store.replaceRoute(next)))
    return fail("That route no longer exists.");
  if (resumed) await syncNow(store, accountId, now);
  return { ok: true };
}

export async function addRedditDestination(
  store: Store,
  accountId: string,
  subredditInput: string,
  now: number,
): Promise<ActionResult> {
  const name = normalizeSubreddit(subredditInput);
  if (name === null) return fail("Enter a subreddit like r/SideProject.");
  const dest: RedditDestination = {
    id: newId(),
    accountId,
    kind: "reddit",
    label: `r/${name}`,
    subreddit: name,
    status: "active",
    createdAt: now,
  };
  await store.putDestination(dest);
  return { ok: true, message: `Added ${dest.label}.` };
}

/** Server-side only: the returned destination holds the webhook token. */
export async function addDiscordDestination(
  store: Store,
  accountId: string,
  webhook: {
    webhookId: string;
    webhookToken: string;
    guildId: string;
    channelId: string;
  },
  now: number,
): Promise<DiscordDestination> {
  const dest: DiscordDestination = {
    id: newId(),
    accountId,
    kind: "discord",
    label: "Discord channel",
    ...webhook,
    status: "active",
    createdAt: now,
  };
  await store.putDestination(dest);
  return dest;
}

export async function renameDestination(
  store: Store,
  accountId: string,
  destId: string,
  label: string,
): Promise<ActionResult> {
  const dest = await ownDestination(store, accountId, destId);
  if (!dest) return fail("That destination no longer exists.");
  const next = label.trim();
  if (next === "") return fail("Enter a name.");
  if (Array.from(next).length > MAX_LABEL)
    return fail("Use 60 characters or fewer.");
  await store.putDestination({ ...dest, label: next });
  return { ok: true };
}

export async function removeDestination(
  store: Store,
  accountId: string,
  destId: string,
): Promise<ActionResult> {
  const dest = await ownDestination(store, accountId, destId);
  if (!dest) return fail("That destination no longer exists.");
  for (const route of await store.listRoutes(accountId))
    if (route.destinationId === destId)
      await store.deleteRoute(accountId, route.id);
  await store.deleteDestination(accountId, destId);
  const account = await store.getAccount(accountId);
  if (account?.notifyDestinationId === destId)
    await store.putAccount({ ...account, notifyDestinationId: null });
  return { ok: true };
}

export async function setNotifyDestination(
  store: Store,
  accountId: string,
  destId: string | null,
): Promise<ActionResult> {
  const account = await store.getAccount(accountId);
  if (!account) return fail("Sign in again to change this.");
  if (destId !== null) {
    const dest = await ownDestination(store, accountId, destId);
    if (dest?.kind !== "discord" && dest?.kind !== "telegram")
      return fail("Pick a Discord or Telegram destination for alerts.");
  }
  await store.putAccount({ ...account, notifyDestinationId: destId });
  return { ok: true };
}

/** Why an action shouldn't call Buffer now, or null when it may. */
function bufferBlocked(
  account: Account,
  state: SyncState,
  now: number,
): ActionResult | null {
  if (account.status === "needs_reauth") return fail(SIGN_IN_AGAIN);
  if (state.retryAt !== null && state.retryAt > now) return fail(RATE_LIMITED);
  return null;
}

async function buffersFailure(
  store: Store,
  account: Account,
  err: unknown,
): Promise<ActionResult | null> {
  if (err instanceof BufferError && err.kind === "auth") {
    await store.putAccount({ ...account, status: "needs_reauth" });
    return fail(SIGN_IN_AGAIN);
  }
  if (err instanceof BufferError || err instanceof TokenBusyError)
    return fail("Couldn't reach Buffer. Try again in a moment.");
  return null;
}

export async function sendLatestPost(
  deps: SyncDeps,
  accountId: string,
  routeId: string,
): Promise<ActionResult> {
  const { store } = deps;
  const route = await ownRoute(store, accountId, routeId);
  if (!route) return fail("That route no longer exists.");
  // Paused means nothing crosses, tests included.
  if (route.paused) return fail("Resume this route first.");
  const destination = await ownDestination(
    store,
    accountId,
    route.destinationId,
  );
  if (!destination) return fail("Pick one of your destinations.");
  if (destination.status !== "active") return fail(RECONNECT);
  const account = await store.getAccount(accountId);
  if (!account) return fail("Sign in again to send a test.");

  const now = deps.now();
  const state = await store.getSyncState(accountId);
  const blocked = bufferBlocked(account, state, now);
  if (blocked) return blocked;
  // Claimed before the Buffer call, and atomically, so neither a double
  // click nor an AI app's parallel calls slip past the cooldown.
  if (
    !(await store.claim(
      `send-latest:${accountId}`,
      SEND_LATEST_COOLDOWN_MS / 1000,
    ))
  )
    return fail("Wait a few seconds before sending another test.");

  const channels = await store.getChannels(accountId);
  const first = channels.find((c) => route.channelIds.includes(c.id));
  const org =
    first?.organizationId ??
    (account.organizationIds.length === 1
      ? account.organizationIds[0]
      : undefined);
  if (org === undefined) return fail(REFRESH_CHANNELS);
  const channelIds = route.channelIds.filter(
    (id) => channels.find((c) => c.id === id)?.organizationId === org,
  );
  // An empty channel filter would ask Buffer for every channel's posts.
  if (channelIds.length === 0) return fail(REFRESH_CHANNELS);

  let nodes: unknown[] = [];
  try {
    const accessToken = await deps.getAccessToken(accountId);
    await store.countApiCall(accountId, dayKey(now));
    const { data, rateLimit } = await deps.buffer({
      accessToken,
      query: LATEST_SENT_QUERY,
      variables: { org, ch: channelIds },
    });
    if (rateLimit) await store.putRateLimit(rateLimit);
    const edges = (data as { posts?: { edges?: unknown } } | null)?.posts
      ?.edges;
    nodes = Array.isArray(edges)
      ? edges.map((e) => (e as { node?: unknown } | undefined)?.node)
      : [];
  } catch (err) {
    const known = await buffersFailure(store, account, err);
    if (known) return known;
    throw err;
  }
  const posts = nodes
    .map((n) => mapPost(n))
    .filter((p): p is Post => p !== null);
  if (posts.length === 0) return fail("No sent posts on these channels yet.");
  // Newest first, so this is the latest post the route would carry.
  const post = posts.find((p) => routeTakesTags(p, route));
  if (!post) return fail("No sent posts with this route's tags yet.");

  const status = await deliverToDestination({
    account,
    destination,
    mirror: toMirrorPost([post], channels),
    deps,
    mode: "test",
  });
  return status === "delivered" || status === "draft_ready"
    ? { ok: true, message: "Sent your latest post." }
    : fail("That didn't go through. Activity has the details.");
}

export async function retryJob(
  deps: SyncDeps,
  accountId: string,
  jobId: string,
): Promise<ActionResult> {
  const ok = await retryFailedJob({ deps, accountId, jobId });
  return ok
    ? { ok: true, message: "Retrying now." }
    : fail("That one can't be retried.");
}

export async function refreshChannels(
  deps: SyncDeps,
  accountId: string,
): Promise<ActionResult> {
  const { store } = deps;
  const account = await store.getAccount(accountId);
  if (!account) return fail("Sign in again to refresh.");
  const now = deps.now();
  const blocked = bufferBlocked(
    account,
    await store.getSyncState(accountId),
    now,
  );
  if (blocked) return blocked;
  const fresh: Channel[] = [];
  let current = account;
  try {
    const accessToken = await deps.getAccessToken(accountId);
    // Organizations first: one joined since signing in brings channels too.
    await store.countApiCall(accountId, dayKey(now));
    const reply = await deps.buffer({
      accessToken,
      query: ACCOUNT_QUERY,
      variables: {},
    });
    if (reply.rateLimit) await store.putRateLimit(reply.rateLimit);
    current = {
      ...account,
      organizationIds: mapAccount(reply.data).organizationIds,
    };
    await store.putAccount(current);
    for (const org of current.organizationIds) {
      await store.countApiCall(accountId, dayKey(now));
      const { data, rateLimit } = await deps.buffer({
        accessToken,
        query: CHANNELS_QUERY,
        variables: { org },
      });
      if (rateLimit) await store.putRateLimit(rateLimit);
      const nodes = (data as { channels?: unknown } | null)?.channels;
      if (Array.isArray(nodes))
        for (const n of nodes) {
          const channel = mapChannel(n);
          if (channel) fresh.push(channel);
        }
    }
  } catch (err) {
    const known = await buffersFailure(store, current, err);
    if (known) return known;
    throw err;
  }
  const queried = new Set(current.organizationIds);
  const kept = (await store.getChannels(accountId)).filter(
    (c) => !queried.has(c.organizationId),
  );
  await store.putChannels(accountId, [...kept, ...fresh]);
  return { ok: true, message: "Channels refreshed." };
}
