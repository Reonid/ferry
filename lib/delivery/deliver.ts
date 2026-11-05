import { raiseAlert } from "../alerts";
import {
  CLAIM_GROUP_TTL_S,
  CLAIM_POST_TTL_S,
  EXCERPT_CHARS,
  MAX_ATTEMPTS,
  RETRY_DELAYS_MS,
  RETRY_JOB_TTL_S,
  WRITE_AHEAD_MS,
} from "../constants";
import { buildDiscordMessages } from "../destinations/discord/format";
import type { sendDiscordMessages } from "../destinations/discord/send";
import { buildRedditDraft } from "../destinations/reddit/draft";
import { buildDraftNotice } from "../destinations/reddit/notice";
import type { Store } from "../store/store";
import type {
  Account,
  ActivityEntry,
  DeliveryOutcome,
  DeliveryStatus,
  Destination,
  MirrorPost,
  RetryJob,
} from "../types";

export interface DeliverDeps {
  store: Store;
  now: () => number;
  sendDiscord: typeof sendDiscordMessages;
  baseUrl: string;
  newToken: () => string;
}

type Failure = Extract<DeliveryOutcome, { ok: false }>;
type Delivery = ActivityEntry["deliveries"][number];

export const retryJobId = (destId: string, groupKey: string) =>
  `${destId}|${groupKey}`;

function excerptOf(text: string): string {
  return Array.from(text).slice(0, EXCERPT_CHARS).join("");
}

/** Replaces (or inserts) this destination's element, keeping the other destinations' statuses. */
async function setDelivery(
  deps: DeliverDeps,
  account: Account,
  mirror: MirrorPost,
  destId: string,
  build: (existing: Delivery | undefined) => Omit<Delivery, "destinationId">,
): Promise<void> {
  const current = await deps.store.getActivity(
    account.accountId,
    mirror.groupKey,
  );
  const others = (current?.deliveries ?? []).filter(
    (d) => d.destinationId !== destId,
  );
  const existing = current?.deliveries.find((d) => d.destinationId === destId);
  await deps.store.upsertActivity(account.accountId, {
    groupKey: mirror.groupKey,
    excerpt: current?.excerpt ?? excerptOf(mirror.text),
    source: current?.source ?? {
      service: mirror.source.service,
      name: mirror.source.name,
    },
    publishedAt: mirror.publishedAt,
    deliveries: [...others, { destinationId: destId, ...build(existing) }],
  });
}

async function dispatch(args: {
  deps: DeliverDeps;
  account: Account;
  destination: Destination;
  mirror: MirrorPost;
  startAt: number;
}): Promise<DeliveryOutcome> {
  const { deps, account, destination, mirror } = args;
  if (destination.kind === "discord") {
    return deps.sendDiscord({
      webhookId: destination.webhookId,
      webhookToken: destination.webhookToken,
      guildId: destination.guildId,
      messages: buildDiscordMessages(mirror),
      startAt: args.startAt,
    });
  }
  const token = deps.newToken();
  const draft = buildRedditDraft({
    post: mirror,
    subreddit: destination.subreddit,
    accountId: account.accountId,
    token,
    now: deps.now(),
  });
  await deps.store.putDraft(draft);
  const draftPageUrl = `${deps.baseUrl}/d/${token}`;
  if (account.notifyDestinationId !== null) {
    const notify = await deps.store.getDestination(account.notifyDestinationId);
    if (notify?.kind === "discord" && notify.status === "active") {
      // A failed notice is ignored: the draft is saved and shown on the dashboard.
      await deps.sendDiscord({
        webhookId: notify.webhookId,
        webhookToken: notify.webhookToken,
        guildId: notify.guildId,
        messages: [buildDraftNotice(draft, draftPageUrl)],
      });
    }
  }
  return { ok: true, url: draftPageUrl };
}

/** Runs one attempt for a job and records the result. Adapter exceptions propagate. */
async function attempt(args: {
  deps: DeliverDeps;
  account: Account;
  destination: Destination;
  job: RetryJob;
}): Promise<DeliveryStatus> {
  const { deps, account, destination, job } = args;
  const startAt = destination.kind === "discord" ? job.sentCount : 0;
  const outcome = await dispatch({
    deps,
    account,
    destination,
    mirror: job.mirror,
    startAt,
  });
  if (!outcome.ok) {
    return handleFailure({ deps, account, destination, job, outcome });
  }
  await deps.store.deleteRetry(job.id);
  const status: DeliveryStatus =
    destination.kind === "discord" ? "delivered" : "draft_ready";
  await setDelivery(deps, account, job.mirror, destination.id, (existing) => {
    // A resumed send returns the url of a later message; keep the original.
    const url = startAt > 0 ? existing?.url : outcome.url;
    return { status, at: deps.now(), ...(url ? { url } : {}) };
  });
  return status;
}

export async function deliverToDestination(args: {
  account: Account;
  destination: Destination;
  mirror: MirrorPost;
  deps: DeliverDeps;
  mode?: "normal" | "test";
}): Promise<DeliveryStatus | "skipped"> {
  const { account, destination, mirror, deps } = args;
  const claimed: string[] = [];
  if ((args.mode ?? "normal") === "normal") {
    const groupOk = await deps.store.claim(
      `${destination.id}:group:${mirror.groupKey}`,
      CLAIM_GROUP_TTL_S,
    );
    if (!groupOk) return "skipped";
    claimed.push(`${destination.id}:group:${mirror.groupKey}`);
    for (const postId of mirror.postIds) {
      const key = `${destination.id}:post:${postId}`;
      const ok = await deps.store.claim(key, CLAIM_POST_TTL_S);
      if (!ok) return "skipped";
      claimed.push(key);
    }
  }

  const job: RetryJob = {
    id: retryJobId(destination.id, mirror.groupKey),
    accountId: account.accountId,
    destinationId: destination.id,
    groupKey: mirror.groupKey,
    mirror,
    attempts: 0,
    sentCount: 0,
    failed: false,
  };
  try {
    await deps.store.putRetry(job, deps.now() + WRITE_AHEAD_MS);
  } catch (err) {
    // Without a job the held claims would drop this group for good: free them.
    try {
      await deps.store.releaseClaims(claimed);
    } catch {
      // Best effort; the original error is what matters.
    }
    throw err;
  }
  await setPending(deps, account, mirror, destination.id);
  return attempt({ deps, account, destination, job });
}

export async function handleFailure(args: {
  deps: DeliverDeps;
  account: Account;
  destination: Destination;
  job: RetryJob;
  outcome: Failure;
}): Promise<DeliveryStatus> {
  const { deps, account, destination, job, outcome } = args;
  const sentCount = outcome.sentCount ?? job.sentCount;

  if (outcome.destinationBroken && destination.kind === "discord") {
    await deps.store.putDestination({ ...destination, status: "broken" });
    for (const route of await deps.store.listRoutes(account.accountId)) {
      if (route.destinationId === destination.id && !route.paused) {
        await deps.store.putRoute({ ...route, paused: true });
      }
    }
    await raiseAlert({
      deps,
      account,
      key: `dest-broken:${destination.id}`,
      message: `Ferry can't post to ${destination.label} anymore. Reconnect it.`,
      supportUrl: null,
    });
    await deps.store.deleteRetry(job.id);
    await setDelivery(deps, account, job.mirror, destination.id, (e) => ({
      status: "failed",
      at: deps.now(),
      reason: outcome.reason,
      ...(e?.url ? { url: e.url } : {}),
    }));
    return "failed";
  }

  if (outcome.retryable && job.attempts + 1 < MAX_ATTEMPTS) {
    const delay = outcome.retryAfterMs ?? RETRY_DELAYS_MS[job.attempts] ?? 0;
    await deps.store.putRetry(
      { ...job, attempts: job.attempts + 1, sentCount },
      deps.now() + delay,
    );
    return "pending";
  }

  await deps.store.putRetry(
    { ...job, attempts: job.attempts + 1, sentCount, failed: true },
    deps.now() + RETRY_JOB_TTL_S * 1000,
  );
  await setDelivery(deps, account, job.mirror, destination.id, (e) => ({
    status: "failed",
    at: deps.now(),
    reason: outcome.reason,
    jobId: job.id,
    ...(e?.url ? { url: e.url } : {}),
  }));
  return "failed";
}

export async function setPending(
  deps: DeliverDeps,
  account: Account,
  mirror: MirrorPost,
  destId: string,
): Promise<void> {
  await setDelivery(deps, account, mirror, destId, (e) => ({
    status: "pending",
    at: deps.now(),
    ...(e?.url ? { url: e.url } : {}),
  }));
}

export async function runJob(args: {
  deps: DeliverDeps;
  account: Account;
  destination: Destination;
  job: RetryJob;
}): Promise<DeliveryStatus> {
  return attempt(args);
}

/** Marks a job permanently failed (kept for the Retry button) and records it in the activity. */
export async function failJob(
  deps: DeliverDeps,
  job: RetryJob,
  reason: string,
): Promise<void> {
  await deps.store.putRetry(
    { ...job, failed: true },
    deps.now() + RETRY_JOB_TTL_S * 1000,
  );
  const account = await deps.store.getAccount(job.accountId);
  if (account) {
    await setDelivery(deps, account, job.mirror, job.destinationId, (e) => ({
      status: "failed",
      at: deps.now(),
      reason,
      jobId: job.id,
      ...(e?.url ? { url: e.url } : {}),
    }));
  }
}
