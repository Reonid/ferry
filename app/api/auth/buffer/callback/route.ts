import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import {
  exchangeBufferCode,
  OAUTH_STATE_COOKIE,
  OAUTH_VERIFIER_COOKIE,
} from "@/lib/auth/buffer-oauth";
import { saveSignIn } from "@/lib/auth/sign-in";
import { bufferRequest } from "@/lib/buffer/client";
import { mapAccount, mapChannel } from "@/lib/buffer/map";
import { ACCOUNT_QUERY, CHANNELS_QUERY } from "@/lib/buffer/queries";
import { baseUrl, env } from "@/lib/env";
import { getSession } from "@/lib/session";
import { getStore } from "@/lib/store";
import type { Channel } from "@/lib/types";

function sameString(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

async function signIn(request: NextRequest): Promise<void> {
  const params = request.nextUrl.searchParams;
  const code = params.get("code");
  const state = params.get("state");
  const savedState = request.cookies.get(OAUTH_STATE_COOKIE)?.value;
  const verifier = request.cookies.get(OAUTH_VERIFIER_COOKIE)?.value;
  if (!code || !state || !savedState || !verifier)
    throw new Error("incomplete");
  if (!sameString(state, savedState)) throw new Error("state mismatch");

  const now = Date.now();
  const tokens = await exchangeBufferCode({
    clientId: env("BUFFER_CLIENT_ID"),
    clientSecret: env("BUFFER_CLIENT_SECRET"),
    code,
    redirectUri: `${baseUrl()}/api/auth/buffer/callback`,
    codeVerifier: verifier,
    now,
  });

  const { data } = await bufferRequest<unknown>({
    accessToken: tokens.accessToken,
    query: ACCOUNT_QUERY,
    now,
  });
  const info = mapAccount(data);

  const channels: Channel[] = [];
  for (const org of info.organizationIds) {
    const result = await bufferRequest<{ channels?: unknown }>({
      accessToken: tokens.accessToken,
      query: CHANNELS_QUERY,
      variables: { org },
      now,
    });
    if (Array.isArray(result.data.channels))
      for (const node of result.data.channels) {
        const channel = mapChannel(node);
        if (channel) channels.push(channel);
      }
  }

  await saveSignIn(getStore(), { info, tokens, channels, now });

  const session = await getSession();
  session.accountId = info.accountId;
  await session.save();
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  let target = "/app";
  try {
    await signIn(request);
  } catch {
    // Details are dropped: errors on this path could echo codes or tokens.
    target = "/?error=signin";
  }
  const response = NextResponse.redirect(`${baseUrl()}${target}`);
  response.cookies.delete(OAUTH_STATE_COOKIE);
  response.cookies.delete(OAUTH_VERIFIER_COOKIE);
  return response;
}
