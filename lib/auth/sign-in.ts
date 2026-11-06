import type { Store } from "@/lib/store/store";
import type { Channel, TokenSet } from "@/lib/types";

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
