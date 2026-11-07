import type {
  Asset,
  Channel,
  LinkCard,
  Post,
  Service,
  ThreadItem,
  UpcomingPost,
} from "@/lib/types";

const SERVICES: readonly string[] = [
  "bluesky",
  "facebook",
  "googlebusiness",
  "instagram",
  "linkedin",
  "mastodon",
  "pinterest",
  "startPage",
  "substack",
  "threads",
  "tiktok",
  "twitter",
  "whatsapp",
  "youtube",
] satisfies Service[];

type Rec = Record<string, unknown>;

function rec(value: unknown): Rec | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Rec)
    : null;
}
function str(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}
function service(value: unknown): Service | null {
  return typeof value === "string" && SERVICES.includes(value)
    ? (value as Service)
    : null;
}

function mapAsset(raw: unknown): Asset | null {
  const a = rec(raw);
  if (!a) return null;
  const type = a.type;
  const source = str(a.source);
  if (!source || (type !== "image" && type !== "video" && type !== "document"))
    return null;
  return {
    type,
    source,
    thumbnail: typeof a.thumbnail === "string" ? a.thumbnail : "",
    mimeType: typeof a.mimeType === "string" ? a.mimeType : "",
    altText: str(rec(a.image)?.altText) ?? "",
  };
}

function mapAssets(raw: unknown): Asset[] {
  return Array.isArray(raw)
    ? raw.map(mapAsset).filter((a): a is Asset => a !== null)
    : [];
}

function mapLink(raw: unknown): LinkCard | null {
  const l = rec(raw);
  const url = str(l?.url);
  if (!l || !url) return null;
  return {
    url,
    title: typeof l.title === "string" ? l.title : "",
    text: typeof l.text === "string" ? l.text : "",
    thumbnail: str(l.thumbnail),
  };
}

export function mapPost(node: unknown): Post | null {
  const n = rec(node);
  if (!n) return null;
  const status = n.status;
  const id = str(n.id);
  const channelId = str(n.channelId);
  const svc = service(n.channelService);
  if ((status !== "sent" && status !== "error") || !id || !channelId || !svc)
    return null;

  const text = typeof n.text === "string" ? n.text : "";
  const metadata = rec(n.metadata);

  let thread: ThreadItem[] = [];
  if (Array.isArray(metadata?.thread)) {
    thread = metadata.thread.flatMap((raw): ThreadItem[] => {
      const t = rec(raw);
      if (!t || typeof t.text !== "string") return [];
      return [{ text: t.text, assets: mapAssets(t.assets) }];
    });
    // Buffer lists the post itself as the thread's first item.
    if (thread[0] && thread[0].text.trim() === text.trim())
      thread = thread.slice(1);
  }

  const err = rec(n.error);
  const errMessage = str(err?.message);

  return {
    id,
    status,
    text,
    dueAt: str(n.dueAt),
    sentAt: str(n.sentAt),
    channelId,
    service: svc,
    contentItemId: str(n.contentItemId),
    externalLink: str(n.externalLink),
    tags: Array.isArray(n.tags)
      ? n.tags.flatMap((raw) => {
          const t = rec(raw);
          const tid = str(t?.id);
          return t && tid
            ? [{ id: tid, name: typeof t.name === "string" ? t.name : "" }]
            : [];
        })
      : [],
    error: err
      ? {
          message: errMessage ?? "Buffer could not publish this post",
          supportUrl: str(err.supportUrl),
        }
      : null,
    assets: mapAssets(n.assets),
    thread,
    link: mapLink(metadata?.linkAttachment),
  };
}

export function mapChannel(node: unknown): Channel | null {
  const n = rec(node);
  if (!n) return null;
  const id = str(n.id);
  const organizationId = str(n.organizationId);
  const svc = service(n.service);
  const name = str(n.name);
  if (!id || !organizationId || !svc || !name) return null;
  return {
    id,
    organizationId,
    service: svc,
    name,
    displayName: str(n.displayName),
    avatar: typeof n.avatar === "string" ? n.avatar : "",
    isDisconnected: n.isDisconnected === true,
    isQueuePaused: n.isQueuePaused === true,
    isLocked: n.isLocked === true,
  };
}

export function mapUpcoming(node: unknown): UpcomingPost | null {
  const n = rec(node);
  if (!n) return null;
  const id = str(n.id);
  const channelId = str(n.channelId);
  const dueAt = str(n.dueAt);
  const status = n.status;
  if (!id || !channelId || !dueAt) return null;
  if (status !== "scheduled" && status !== "sending") return null;
  return { id, channelId, dueAt, status };
}

function edgeNodes(connection: unknown): unknown[] {
  const edges = rec(connection)?.edges;
  return Array.isArray(edges) ? edges.map((e) => rec(e)?.node) : [];
}

function pushUnique<T extends { id: string }>(
  list: T[],
  seen: Set<string>,
  item: T | null,
): void {
  if (!item || seen.has(item.id)) return;
  seen.add(item.id);
  list.push(item);
}

export function mapSyncData(
  data: unknown,
  orgCount: number,
): { posts: Post[]; upcoming: UpcomingPost[]; channels: Channel[] } {
  const d = rec(data) ?? {};
  const posts: Post[] = [];
  const upcoming: UpcomingPost[] = [];
  const channels: Channel[] = [];
  const seenPosts = new Set<string>();
  const seenUpcoming = new Set<string>();
  const seenChannels = new Set<string>();
  for (let i = 0; i < orgCount; i++) {
    for (const node of edgeNodes(d[`r${i}`]))
      pushUnique(posts, seenPosts, mapPost(node));
    for (const node of edgeNodes(d[`u${i}`]))
      pushUnique(upcoming, seenUpcoming, mapUpcoming(node));
    const c = d[`c${i}`];
    if (Array.isArray(c))
      for (const node of c)
        pushUnique(channels, seenChannels, mapChannel(node));
  }
  return { posts, upcoming, channels };
}

export function mapAccount(data: unknown): {
  accountId: string;
  name: string | null;
  timezone: string | null;
  organizationIds: string[];
} {
  const account = rec(rec(data)?.account);
  const accountId = str(account?.id);
  if (!account || !accountId)
    throw new Error("Buffer account response had no account id");
  const orgs = Array.isArray(account.organizations)
    ? account.organizations
    : [];
  return {
    accountId,
    name: str(account.name),
    timezone: str(account.timezone),
    organizationIds: orgs.flatMap((o) => {
      const id = str(rec(o)?.id);
      return id ? [id] : [];
    }),
  };
}
