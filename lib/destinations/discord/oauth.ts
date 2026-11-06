const AUTHORIZE_URL = "https://discord.com/oauth2/authorize";
const TOKEN_URL = "https://discord.com/api/oauth2/token";

export const DISCORD_STATE_COOKIE = "ferry_discord_state";

export class DiscordOAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DiscordOAuthError";
  }
}

export function discordAuthorizeUrl(args: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const q = new URLSearchParams({
    response_type: "code",
    client_id: args.clientId,
    scope: "webhook.incoming",
    state: args.state,
    redirect_uri: args.redirectUri,
  });
  return `${AUTHORIZE_URL}?${q.toString()}`;
}

export async function exchangeDiscordCode(args: {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
  fetchImpl?: typeof fetch;
}): Promise<{
  webhookId: string;
  webhookToken: string;
  guildId: string;
  channelId: string;
}> {
  const doFetch = args.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await doFetch(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: args.code,
        redirect_uri: args.redirectUri,
        client_id: args.clientId,
        client_secret: args.clientSecret,
      }).toString(),
    });
  } catch {
    throw new DiscordOAuthError("Could not reach Discord");
  }
  if (!res.ok) {
    throw new DiscordOAuthError(
      `Discord refused the code (HTTP ${res.status})`,
    );
  }
  const json: unknown = await res.json().catch(() => null);
  const w = (json as { webhook?: Record<string, unknown> } | null)?.webhook;
  if (
    !w ||
    typeof w.id !== "string" ||
    typeof w.token !== "string" ||
    typeof w.guild_id !== "string" ||
    typeof w.channel_id !== "string"
  ) {
    throw new DiscordOAuthError("Discord did not return a webhook");
  }
  return {
    webhookId: w.id,
    webhookToken: w.token,
    guildId: w.guild_id,
    channelId: w.channel_id,
  };
}
