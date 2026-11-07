import { mapSyncData } from "@/lib/buffer/map";
import { parseRateLimit } from "@/lib/buffer/ratelimit";
import type { RateLimitSnapshot } from "@/lib/types";

/** Organization limits, a tiny read-only query for the probe. */
export const ORG_LIMITS_QUERY = `query OrgLimits {
  account { organizations { id limits { tags } } }
}`;

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec | null =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : null;
const nonEmptyArray = (v: unknown): boolean => Array.isArray(v) && v.length > 0;

/** Raw `node` objects of every recent-posts selection (r0, r1, ...). */
function rawRecent(data: unknown, orgCount: number): Rec[] {
  const d = rec(data) ?? {};
  const nodes: Rec[] = [];
  for (let i = 0; i < orgCount; i++) {
    const edges = rec(d[`r${i}`])?.edges;
    if (!Array.isArray(edges)) continue;
    for (const edge of edges) {
      const node = rec(rec(edge)?.node);
      if (node) nodes.push(node);
    }
  }
  return nodes;
}

/** The first image asset's source URL. It stays inside the server. */
export function firstImageSource(
  data: unknown,
  orgCount: number,
): string | null {
  for (const node of rawRecent(data, orgCount)) {
    if (!Array.isArray(node.assets)) continue;
    for (const asset of node.assets) {
      const a = rec(asset);
      if (a?.type === "image" && typeof a.source === "string" && a.source)
        return a.source;
    }
  }
  return null;
}

/** The host of a URL, or null. Never the path or query. */
export function hostOf(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

export interface ProbeSummary {
  rateLimitHeaders: { rateLimit: string | null; policy: string | null };
  parsed: RateLimitSnapshot | null;
  counts: { recent: number; upcoming: number; channels: number };
  fieldsPresent: {
    assets: number;
    tags: number;
    metadata: number;
    externalLink: number;
  };
  threadFirstItemRepeatsText: boolean | null;
  sharedContentItemIds: number;
  publishNowDueAt: {
    count: number;
    minGapSeconds: number | null;
    maxGapSeconds: number | null;
  };
}

/**
 * Boils a raw sync response down to counts and shapes. Post text, tokens and
 * URLs never appear in the result.
 */
export function summarizeProbe(
  data: unknown,
  orgCount: number,
  headers: { rateLimit: string | null; policy: string | null },
  now: number,
): ProbeSummary {
  const mapped = mapSyncData(data, orgCount);
  const nodes = rawRecent(data, orgCount);

  const fieldsPresent = { assets: 0, tags: 0, metadata: 0, externalLink: 0 };
  let threads = 0;
  let repeats = 0;
  const copies = new Map<string, number>();
  const gaps: number[] = [];

  for (const n of nodes) {
    if (nonEmptyArray(n.assets)) fieldsPresent.assets++;
    if (nonEmptyArray(n.tags)) fieldsPresent.tags++;
    const metadata = rec(n.metadata);
    if (metadata && Object.keys(metadata).length > 0) fieldsPresent.metadata++;
    if (typeof n.externalLink === "string" && n.externalLink)
      fieldsPresent.externalLink++;

    const thread = metadata?.thread;
    if (nonEmptyArray(thread)) {
      threads++;
      const first = rec((thread as unknown[])[0]);
      if (
        typeof first?.text === "string" &&
        typeof n.text === "string" &&
        first.text.trim() === n.text.trim()
      )
        repeats++;
    }

    if (typeof n.contentItemId === "string" && n.contentItemId)
      copies.set(n.contentItemId, (copies.get(n.contentItemId) ?? 0) + 1);

    if (n.status === "sent" && typeof n.dueAt === "string") {
      const due = Date.parse(n.dueAt);
      const sent =
        typeof n.sentAt === "string" ? Date.parse(n.sentAt) : Number.NaN;
      if (!Number.isNaN(due) && !Number.isNaN(sent))
        gaps.push(Math.round((sent - due) / 1000));
    }
  }

  return {
    rateLimitHeaders: headers,
    parsed: parseRateLimit(headers.rateLimit, now),
    counts: {
      recent: mapped.posts.length,
      upcoming: mapped.upcoming.length,
      channels: mapped.channels.length,
    },
    fieldsPresent,
    threadFirstItemRepeatsText: threads === 0 ? null : repeats > 0,
    sharedContentItemIds: [...copies.values()].filter((c) => c >= 2).length,
    publishNowDueAt: {
      count: gaps.length,
      minGapSeconds: gaps.length ? Math.min(...gaps) : null,
      maxGapSeconds: gaps.length ? Math.max(...gaps) : null,
    },
  };
}

/** `limits.tags` per organization from an ORG_LIMITS_QUERY response. */
export function summarizeOrgLimits(
  data: unknown,
): { organizationId: string; tags: unknown }[] {
  const orgs = rec(rec(data)?.account)?.organizations;
  if (!Array.isArray(orgs)) return [];
  return orgs.flatMap((o) => {
    const r = rec(o);
    return r && typeof r.id === "string"
      ? [{ organizationId: r.id, tags: rec(r.limits)?.tags ?? null }]
      : [];
  });
}
