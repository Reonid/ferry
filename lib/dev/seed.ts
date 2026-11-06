import { redditSubmitUrl } from "@/lib/destinations/reddit/draft";
import type { Store } from "@/lib/store";
import type {
  ActivityEntry,
  Channel,
  MirrorPost,
  RedditDraft,
} from "@/lib/types";

const ACCOUNT_ID = "dev-account";
const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;

/**
 * Seeds a realistic account for local development and browser tests.
 * Idempotent: every record has a fixed id, so re-running overwrites in place.
 * Never touches Buffer or Discord.
 */
export async function seedDevAccount(
  store: Store,
  now: number,
): Promise<string> {
  const id = ACCOUNT_ID;
  const existing = await store.getAccount(id);

  await store.putAccount({
    accountId: id,
    name: "Ferry Dev",
    timezone: "Europe/Zagreb",
    organizationIds: ["dev-org"],
    status: "active",
    notifyDestinationId: existing?.notifyDestinationId ?? "dev-discord",
    createdAt: existing?.createdAt ?? now - 3 * 24 * HOUR,
  });
  await store.putTokens(id, {
    accessToken: "dev-access-token",
    refreshToken: "dev-refresh-token",
    expiresAt: now + 24 * HOUR,
  });

  const channels: Channel[] = [
    {
      id: "dev-bluesky",
      organizationId: "dev-org",
      service: "bluesky",
      name: "Ferry Dev",
      displayName: "Ferry Dev",
      avatar: "",
      isDisconnected: false,
      isQueuePaused: false,
      isLocked: false,
    },
    {
      id: "dev-linkedin",
      organizationId: "dev-org",
      service: "linkedin",
      name: "Leon Dev",
      displayName: "Leon Dev",
      avatar: "",
      isDisconnected: false,
      isQueuePaused: false,
      isLocked: false,
    },
  ];
  await store.putChannels(id, channels);

  await store.putDestination({
    id: "dev-discord",
    accountId: id,
    kind: "discord",
    label: "#announcements",
    webhookId: "100000000000000001",
    webhookToken: "dev-webhook-token-not-real",
    guildId: "100000000000000002",
    channelId: "100000000000000003",
    status: "active",
    createdAt: now - 3 * 24 * HOUR,
  });
  await store.putDestination({
    id: "dev-reddit",
    accountId: id,
    kind: "reddit",
    label: "r/SideProject",
    subreddit: "SideProject",
    status: "active",
    createdAt: now - 3 * 24 * HOUR,
  });
  await store.putRoute({
    id: "dev-route",
    accountId: id,
    channelIds: ["dev-bluesky", "dev-linkedin"],
    tagNames: [],
    destinationId: "dev-discord",
    activeSince: now - 3 * 24 * HOUR,
    paused: false,
    createdAt: now - 3 * 24 * HOUR,
  });

  const failedPost: MirrorPost = {
    groupKey: "dev-group-failed",
    postIds: ["dev-post-2"],
    text: "Shipped dark mode for the dashboard today. Small change, big relief for late-night sessions.",
    threadTexts: [],
    images: [],
    video: null,
    link: null,
    permalinks: [],
    source: {
      channelId: "dev-linkedin",
      service: "linkedin",
      name: "Leon Dev",
      avatar: "",
    },
    publishedAt: now - 2 * HOUR,
  };
  await store.putRetry(
    {
      id: "dev-retry-job",
      accountId: id,
      destinationId: "dev-discord",
      groupKey: failedPost.groupKey,
      mirror: failedPost,
      attempts: 5,
      sentCount: 0,
      failed: true,
    },
    now + 24 * HOUR,
  );

  const delivered: ActivityEntry = {
    groupKey: "dev-group-delivered",
    excerpt: "We just opened the beta. Come break things with us.",
    source: { service: "bluesky", name: "Ferry Dev" },
    publishedAt: now - 5 * HOUR,
    deliveries: [
      {
        destinationId: "dev-discord",
        status: "delivered",
        at: now - 5 * HOUR + MINUTE,
      },
      {
        destinationId: "dev-reddit",
        status: "draft_ready",
        at: now - 5 * HOUR + MINUTE,
      },
    ],
  };
  const failed: ActivityEntry = {
    groupKey: failedPost.groupKey,
    excerpt:
      "Shipped dark mode for the dashboard today. Small change, big relief",
    source: { service: "linkedin", name: "Leon Dev" },
    publishedAt: failedPost.publishedAt,
    deliveries: [
      {
        destinationId: "dev-discord",
        status: "failed",
        at: now - 2 * HOUR + 5 * MINUTE,
        reason: "Discord returned HTTP 500",
        jobId: "dev-retry-job",
      },
    ],
  };
  await store.upsertActivity(id, delivered);
  await store.upsertActivity(id, failed);

  const title = "We just opened the beta of our scheduling side project";
  const body = "We just opened the beta. Come break things with us.";
  const draft: RedditDraft = {
    token: "dev-draft",
    accountId: id,
    subreddit: "SideProject",
    title,
    body,
    kind: "self",
    url: null,
    // Ferry's own share image, so the draft page shows an image offline.
    images: [
      {
        url: "/opengraph-image",
        alt: "Ferry's share card: a boat crossing a dashed route between two shores.",
        mimeType: "image/png",
      },
    ],
    submitUrl: redditSubmitUrl({
      subreddit: "SideProject",
      kind: "self",
      title,
      body,
      url: null,
    }),
    createdAt: now - 5 * HOUR + MINUTE,
  };
  await store.putDraft(draft);

  await store.raiseAlertOnce(id, {
    key: "dev-discord-failing",
    message:
      "Discord delivery to #announcements failed after 5 attempts. Check the webhook and retry.",
    supportUrl: null,
    at: now - 2 * HOUR + 5 * MINUTE,
  });

  return id;
}
