import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { currentAccount } from "@/lib/auth/current";
import {
  DISCORD_STATE_COOKIE,
  exchangeDiscordCode,
} from "@/lib/destinations/discord/oauth";
import { sendDiscordMessages } from "@/lib/destinations/discord/send";
import { baseUrl, env } from "@/lib/env";
import { addDiscordDestination } from "@/lib/routes/manage";
import { getStore } from "@/lib/store";

function sameString(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

async function connect(request: NextRequest): Promise<void> {
  const account = await currentAccount();
  if (!account) throw new Error("no session");
  const params = request.nextUrl.searchParams;
  const code = params.get("code");
  const state = params.get("state");
  const saved = request.cookies.get(DISCORD_STATE_COOKIE)?.value;
  if (!code || !state || !saved) throw new Error("incomplete");
  if (!sameString(state, saved)) throw new Error("state mismatch");

  const webhook = await exchangeDiscordCode({
    clientId: env("DISCORD_CLIENT_ID"),
    clientSecret: env("DISCORD_CLIENT_SECRET"),
    code,
    redirectUri: `${baseUrl()}/api/discord/callback`,
  });
  const destination = await addDiscordDestination(
    getStore(),
    account.accountId,
    webhook,
    Date.now(),
  );
  // A failed hello does not undo the connection.
  await sendDiscordMessages({
    webhookId: destination.webhookId,
    webhookToken: destination.webhookToken,
    guildId: destination.guildId,
    messages: [
      {
        content: "Ferry is connected. Posts from Buffer will arrive here.",
        username: "Ferry",
        allowed_mentions: { parse: [] },
      },
    ],
  }).catch(() => undefined);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  let target = "/app?connected=discord";
  if (request.nextUrl.searchParams.get("error") === "access_denied") {
    target = "/app?error=discord_denied";
  } else {
    try {
      await connect(request);
    } catch (err) {
      // Details are dropped: errors on this path could echo codes or webhook tokens.
      target =
        err instanceof Error && err.message === "no session"
          ? "/"
          : "/app?error=discord";
    }
  }
  const response = NextResponse.redirect(`${baseUrl()}${target}`);
  response.cookies.delete(DISCORD_STATE_COOKIE);
  return response;
}
