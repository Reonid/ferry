import { DiscordOAuthError } from "@/lib/destinations/discord/oauth";
import type { Store } from "@/lib/store/store";
import type { Channel, TokenSet } from "@/lib/types";
import { OAuthError } from "./buffer-oauth";

/**
 * Logs one line for a failed sign-in or connection: the error's name and,
 * for an OAuth error, its code. Never the message, which could echo an
 * authorization code or a token.
 */
export function logSignInFailure(what: string, err: unknown): void {
  const name = err instanceof Error ? err.name : "UnknownError";
  const code =
    err instanceof OAuthError || err instanceof DiscordOAuthError
      ? err.code.replace(/[^\w.-]/g, "").slice(0, 40)
      : "";
  console.error(`ferry: ${what} failed (${code ? `${name} ${code}` : name})`);
}

/**
 * Records a finished Buffer sign-in: the account, its tokens and its
 * channels. Signing in again resolves the "sign in again" alert.
 */
export async function saveSignIn(
  store: Store,
  args: {
    info: {
      accountId: string;
      name: string | null;
      timezone: string | null;
      organizationIds: string[];
    };
    tokens: TokenSet;
    channels: Channel[];
    now: number;
  },
): Promise<void> {
  const { info, now } = args;
  const existing = await store.getAccount(info.accountId);
  await store.putAccount({
    accountId: info.accountId,
    name: info.name,
    timezone: info.timezone,
    organizationIds: info.organizationIds,
    status: "active",
    notifyDestinationId: existing?.notifyDestinationId ?? null,
    createdAt: existing?.createdAt ?? now,
  });
  await store.putTokens(info.accountId, args.tokens);
  await store.putChannels(info.accountId, args.channels);
  await store.clearAlertKey(info.accountId, "buffer-auth");
}
