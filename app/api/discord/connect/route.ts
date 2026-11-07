import { NextResponse } from "next/server";
import { currentAccount } from "@/lib/auth/current";
import { randomState } from "@/lib/auth/pkce";
import {
  DISCORD_STATE_COOKIE,
  discordAuthorizeUrl,
} from "@/lib/destinations/discord/oauth";
import { baseUrl, env } from "@/lib/env";

export async function GET(): Promise<NextResponse> {
  if (!(await currentAccount())) return NextResponse.redirect(`${baseUrl()}/`);
  const state = randomState();
  const response = NextResponse.redirect(
    discordAuthorizeUrl({
      clientId: env("DISCORD_CLIENT_ID"),
      // baseUrl, not the request: redirect_uri must match the registered URI exactly.
      redirectUri: `${baseUrl()}/api/discord/callback`,
      state,
    }),
  );
  response.cookies.set(DISCORD_STATE_COOKIE, state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });
  return response;
}
