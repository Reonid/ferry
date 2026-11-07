import { OAuthError } from "@/lib/auth/buffer-oauth";
import { LOCK_REFRESH_MS, TOKEN_REFRESH_MARGIN_MS } from "@/lib/constants";
import type { Store } from "@/lib/store/store";
import type { TokenSet } from "@/lib/types";
import { BufferError } from "./client";

const WAIT_MS = 500;
const MAX_WAITS = 10;

export class TokenBusyError extends Error {
  constructor() {
    super("Another request is refreshing the Buffer token");
    this.name = "TokenBusyError";
  }
}

const realSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Returns a usable access token, refreshing under a per-account lock.
 * Buffer refresh tokens are single-use: the new pair is saved before the
 * lock is released and before anything else can see the new access token.
 */
export async function getAccessToken(args: {
  store: Store;
  accountId: string;
  now: () => number;
  refresh: (refreshToken: string) => Promise<TokenSet>;
  sleep?: (ms: number) => Promise<void>;
}): Promise<string> {
  const { store, accountId, now, refresh } = args;
  const sleep = args.sleep ?? realSleep;

  const isFresh = (t: TokenSet): boolean =>
    t.expiresAt - now() > TOKEN_REFRESH_MARGIN_MS;
  const missing = () =>
    new BufferError("No Buffer tokens stored for this account", {
      kind: "auth",
    });

  const first = await store.getTokens(accountId);
  if (first === null) throw missing();
  if (isFresh(first)) return first.accessToken;

  const lockName = `refresh:${accountId}`;
  for (let waited = 0; ; waited++) {
    const lock = await store.acquireLock(lockName, LOCK_REFRESH_MS);
    if (lock !== null) {
      try {
        const current = await store.getTokens(accountId);
        if (current === null) throw missing();
        if (isFresh(current)) return current.accessToken;
        let next: TokenSet;
        try {
          next = await refresh(current.refreshToken);
        } catch (error) {
          if (error instanceof OAuthError && error.code === "invalid_grant") {
            const account = await store.getAccount(accountId);
            if (account)
              await store.putAccount({ ...account, status: "needs_reauth" });
            throw new BufferError("Buffer sign-in expired; sign in again", {
              kind: "auth",
            });
          }
          throw error;
        }
        await store.putTokens(accountId, next);
        return next.accessToken;
      } finally {
        await store.releaseLock(lockName, lock);
      }
    }
    if (waited >= MAX_WAITS) throw new TokenBusyError();
    await sleep(WAIT_MS);
    const latest = await store.getTokens(accountId);
    if (latest !== null && isFresh(latest)) return latest.accessToken;
  }
}
