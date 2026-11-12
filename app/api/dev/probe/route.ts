import { NextResponse } from "next/server";
import { refreshBufferToken } from "@/lib/auth/buffer-oauth";
import { currentAccount } from "@/lib/auth/current";
import { bufferRequest } from "@/lib/buffer/client";
import { buildSyncQuery, syncVariables } from "@/lib/buffer/queries";
import { getAccessToken } from "@/lib/buffer/tokens";
import {
  firstImageSource,
  hostOf,
  ORG_LIMITS_QUERY,
  summarizeOrgLimits,
  summarizeProbe,
} from "@/lib/dev/probe";
import { env } from "@/lib/env";
import { fetchImage } from "@/lib/net/fetch-image";
import { getStore } from "@/lib/store";

const DAY = 24 * 60 * 60 * 1000;

/**
 * Development only, signed in: one sync-shaped Buffer call plus one tiny
 * limits query. Answers how the API behaves with an OAuth token. It returns
 * counts and shapes, never post text, tokens or full URLs.
 */
export async function GET(): Promise<NextResponse> {
  const account =
    process.env.NODE_ENV === "development" ? await currentAccount() : null;
  if (!account) return new NextResponse("Not found", { status: 404 });

  const store = getStore();
  const now = Date.now();
  const accessToken = await getAccessToken({
    store,
    accountId: account.accountId,
    now: () => Date.now(),
    refresh: (refreshToken) =>
      refreshBufferToken({
        clientId: env("BUFFER_CLIENT_ID"),
        clientSecret: env("BUFFER_CLIENT_SECRET"),
        refreshToken,
        now: Date.now(),
      }),
  });

  const cached = await store.getChannels(account.accountId);
  // Buffer refuses a whole posts query that names a locked channel.
  const readable = cached.filter((c) => !c.isLocked);
  const byOrg = new Map<string, string[]>();
  for (const c of cached)
    byOrg.set(c.organizationId, [
      ...(byOrg.get(c.organizationId) ?? []),
      ...(c.isLocked ? [] : [c.id]),
    ]);
  const orgs = [...byOrg].map(([organizationId, channelIds]) => ({
    organizationId,
    channelIds,
  }));
  if (orgs.length === 0)
    return NextResponse.json({
      error: "No channels yet. Refresh them in Settings.",
    });

  const headers: { rateLimit: string | null; policy: string | null } = {
    rateLimit: null,
    policy: null,
  };
  const { data } = await bufferRequest<unknown>({
    accessToken,
    query: buildSyncQuery(orgs),
    variables: syncVariables({
      orgs,
      since: now - 30 * DAY,
      until: now + 2 * DAY,
    }),
    now,
    onResponse: (h) => {
      headers.rateLimit = h.get("ratelimit");
      headers.policy = h.get("ratelimit-policy");
    },
  });

  const limits = await bufferRequest<unknown>({
    accessToken,
    query: ORG_LIMITS_QUERY,
    now,
  });

  const source = firstImageSource(data, orgs.length);
  const image = source ? await fetchImage(source) : null;

  return NextResponse.json({
    ...summarizeProbe(data, orgs.length, headers, now),
    firstImageFetch: {
      ...(image
        ? {
            ok: true,
            mimeType: image.mimeType,
            bytes: image.bytes.byteLength,
          }
        : { ok: false }),
      host: source ? hostOf(source) : null,
    },
    organizationTagLimits: summarizeOrgLimits(limits.data),
    lockedChannelsSkipped: cached.length - readable.length,
  });
}
