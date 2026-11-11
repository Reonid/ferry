import { NextResponse, type NextRequest } from "next/server";
import { NEXT_COOKIE, safeNext } from "@/lib/auth/next";
import { createPkcePair, randomState } from "@/lib/auth/pkce";
import {
  bufferAuthorizeUrl,
  OAUTH_STATE_COOKIE,
  OAUTH_VERIFIER_COOKIE,
} from "@/lib/auth/buffer-oauth";
import { baseUrl, env } from "@/lib/env";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { verifier, challenge } = createPkcePair();
  const state = randomState();
  const response = NextResponse.redirect(
    bufferAuthorizeUrl({
      clientId: env("BUFFER_CLIENT_ID"),
      // baseUrl, not the request: redirect_uri must match the registered URI exactly.
      redirectUri: `${baseUrl()}/api/auth/buffer/callback`,
      state,
      codeChallenge: challenge,
    }),
  );
  const options = {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  } as const;
  response.cookies.set(OAUTH_STATE_COOKIE, state, options);
  response.cookies.set(OAUTH_VERIFIER_COOKIE, verifier, options);
  // Only the consent screen asks to be returned to (lib/auth/next.ts).
  const next = safeNext(request.nextUrl.searchParams.get("next"));
  if (next) response.cookies.set(NEXT_COOKIE, next, options);
  else response.cookies.delete(NEXT_COOKIE);
  return response;
}
