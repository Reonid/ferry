import { randomBytes } from "node:crypto";
import { createFakeRedis, createStore, type Store } from "../store";
import type { Account } from "../types";
import { registerClient, type OAuthClient } from "./clients";

/** Shared setup for the OAuth tests: a store, a key, Ferry's URLs and an account. */

export const BASE = "https://ferry.example";
export const RESOURCE = `${BASE}/mcp`;
export const CLAUDE_CALLBACK = "https://claude.ai/api/mcp/auth_callback";

export function oauthFixture() {
  const key = randomBytes(32);
  const store: Store = createStore(createFakeRedis(), randomBytes(32));
  const ctx = () => ({
    store,
    key,
    issuer: BASE,
    resource: RESOURCE,
    now: Date.now(),
  });
  function client(metadata: Record<string, unknown>): {
    client: OAuthClient;
    secret: string | null;
  } {
    const result = registerClient(metadata, key, Date.now());
    if (!result.ok) throw new Error(result.description);
    return { client: result.client, secret: result.clientSecret };
  }
  async function account(id = "acct"): Promise<Account> {
    const a: Account = {
      accountId: id,
      name: "Leon",
      timezone: "Europe/Zagreb",
      organizationIds: ["org"],
      status: "active",
      notifyDestinationId: null,
      createdAt: 1,
    };
    await store.putAccount(a);
    return a;
  }
  return { key, store, ctx, client, account };
}
