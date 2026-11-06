export type Service =
  | "bluesky"
  | "facebook"
  | "googlebusiness"
  | "instagram"
  | "linkedin"
  | "mastodon"
  | "pinterest"
  | "startPage"
  | "substack"
  | "threads"
  | "tiktok"
  | "twitter"
  | "whatsapp"
  | "youtube";

export interface Channel {
  id: string;
  organizationId: string;
  service: Service;
  name: string;
  displayName: string | null;
  avatar: string;
  isDisconnected: boolean;
  isQueuePaused: boolean;
  isLocked: boolean;
}
export interface Asset {
  type: "image" | "video" | "document";
  source: string;
  thumbnail: string;
  mimeType: string;
  altText: string;
}
export interface LinkCard {
  url: string;
  title: string;
  text: string;
  thumbnail: string | null;
}
export interface ThreadItem {
  text: string;
  assets: Asset[];
}
export interface Post {
  id: string;
  status: "sent" | "error";
  text: string;
  dueAt: string | null;
  sentAt: string | null;
  channelId: string;
  service: Service;
  contentItemId: string | null;
  externalLink: string | null;
  tags: { id: string; name: string }[];
  error: { message: string; supportUrl: string | null } | null;
  assets: Asset[];
  thread: ThreadItem[];
  link: LinkCard | null;
}
export interface UpcomingPost {
  id: string;
  channelId: string;
  dueAt: string;
  status: "scheduled" | "sending";
}
export interface RateWindow {
  name: string;
  remaining: number;
  resetSeconds: number;
}
export interface RateLimitSnapshot {
  observedAt: number;
  windows: RateWindow[];
}

export interface Account {
  accountId: string;
  name: string | null;
  timezone: string | null;
  organizationIds: string[];
  status: "active" | "needs_reauth";
  notifyDestinationId: string | null;
  createdAt: number;
}
export interface TokenSet {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}
export interface Route {
  id: string;
  accountId: string;
  channelIds: string[];
  tagNames: string[];
  destinationId: string;
  activeSince: number;
  paused: boolean;
  createdAt: number;
}
export interface DiscordDestination {
  id: string;
  accountId: string;
  kind: "discord";
  label: string;
  webhookId: string;
  webhookToken: string;
  guildId: string;
  channelId: string;
  status: "active" | "broken";
  createdAt: number;
}
export interface RedditDestination {
  id: string;
  accountId: string;
  kind: "reddit";
  label: string;
  subreddit: string;
  status: "active";
  createdAt: number;
}
export type Destination = DiscordDestination | RedditDestination;
export interface PublicDestination {
  id: string;
  kind: Destination["kind"];
  label: string;
  status: "active" | "broken";
}

export interface MirrorImage {
  url: string;
  alt: string;
  mimeType: string;
}
export interface MirrorPost {
  groupKey: string;
  postIds: string[];
  text: string;
  threadTexts: string[];
  images: MirrorImage[];
  video: { url: string; thumbnail: string } | null;
  link: LinkCard | null;
  permalinks: { service: Service; url: string }[];
  source: { channelId: string; service: Service; name: string; avatar: string };
  publishedAt: number;
}
export type DeliveryOutcome =
  | { ok: true; url?: string }
  | {
      ok: false;
      retryable: boolean;
      reason: string;
      retryAfterMs?: number;
      destinationBroken?: boolean;
      sentCount?: number;
    };
export type DeliveryStatus = "pending" | "delivered" | "draft_ready" | "failed";
export interface ActivityEntry {
  groupKey: string;
  excerpt: string;
  source: { service: Service; name: string };
  publishedAt: number;
  deliveries: {
    destinationId: string;
    status: DeliveryStatus;
    at: number;
    url?: string;
    reason?: string;
    jobId?: string;
  }[];
}
export interface RedditDraft {
  token: string;
  accountId: string;
  subreddit: string;
  title: string;
  body: string;
  kind: "self" | "link";
  url: string | null;
  images: MirrorImage[];
  submitUrl: string;
  createdAt: number;
}
export interface Alert {
  key: string;
  message: string;
  supportUrl: string | null;
  at: number;
}
export interface SyncState {
  checkpoint: number | null;
  overdueAttempts: number;
  lastSyncAt: number | null;
  nextRunAt: number | null;
  liveUntil: number | null;
  lastSendLatestAt: number | null;
  retryAt: number | null;
}
export interface RetryJob {
  id: string;
  accountId: string;
  destinationId: string;
  groupKey: string;
  mirror: MirrorPost;
  attempts: number;
  sentCount: number;
  failed: boolean;
}
