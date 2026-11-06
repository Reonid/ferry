import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OAuthError } from "@/lib/auth/buffer-oauth";
import { TOKEN_REFRESH_MARGIN_MS } from "@/lib/constants";
import { createFakeRedis, createStore, type Store } from "@/lib/store";
import type { Account, TokenSet } from "@/lib/types";
import { BufferError } from "./client";
import { getAccessToken, TokenBusyError } from "./tokens";

const NOW = 10_000_000;
let store: Store;

const account: Account = {
  accountId: "acc",
  name: "Acc",
  timezone: null,
  organizationIds: ["org"],
  status: "active",
  notifyDestinationId: null,
  createdAt: 1,
};
const stale: TokenSet = {
  accessToken: "old-a",
  refreshToken: "old-r",
  expiresAt: NOW + TOKEN_REFRESH_MARGIN_MS - 1,
};
const renewed: TokenSet = {
  accessToken: "new-a",
  refreshToken: "new-r",
  expiresAt: NOW + 3_600_000,
};
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

beforeEach(async () => {
  store = createStore(createFakeRedis(), randomBytes(32));
  await store.putAccount(account);
});

describe("getAccessToken", () => {
  it("returns a fresh token without refreshing", async () => {
    await store.putTokens("acc", { ...renewed, accessToken: "fresh" });
    const refresh = vi.fn();
    const token = await getAccessToken({
      store,
      accountId: "acc",
      now: () => NOW,
      refresh,
    });
    expect(token).toBe("fresh");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("refreshes a stale token and saves it before returning", async () => {
    await store.putTokens("acc", stale);
    let savedWhenRefreshReturned: TokenSet | null = null;
    const refresh = vi.fn(async (refreshToken: string) => {
      expect(refreshToken).toBe("old-r");
      savedWhenRefreshReturned = await store.getTokens("acc");
      return renewed;
    });
    const token = await getAccessToken({
      store,
      accountId: "acc",
      now: () => NOW,
      refresh,
    });
    expect(token).toBe("new-a");
    expect(savedWhenRefreshReturned).toEqual(stale);
    expect(await store.getTokens("acc")).toEqual(renewed);
    // lock released
    expect(await store.acquireLock("refresh:acc", 1000)).not.toBeNull();
  });

  it("refreshes once when two callers race", async () => {
    await store.putTokens("acc", stale);
    const refresh = vi.fn(async () => {
      await tick();
      return renewed;
    });
    const call = () =>
      getAccessToken({
        store,
        accountId: "acc",
        now: () => NOW,
        refresh,
        sleep: tick,
      });
    const [a, b] = await Promise.all([call(), call()]);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(a).toBe("new-a");
    expect(b).toBe("new-a");
  });

  it("re-reads tokens inside the lock", async () => {
    await store.putTokens("acc", stale);
    let saved = false;
    let openRefresh = () => {};
    const refreshGate = new Promise<void>((resolve) => {
      openRefresh = resolve;
    });
    const refresh = vi.fn(async () => {
      await refreshGate;
      return renewed;
    });
    const first: Store = {
      ...store,
      async putTokens(id, tokens) {
        await store.putTokens(id, tokens);
        saved = true;
      },
    };
    // The second caller's re-read after its sleep still finds the stale
    // pair, and the lock only opens to it once the first caller has saved:
    // only the read inside the lock can see the renewed pair.
    let reads = 0;
    const second: Store = {
      ...store,
      async getTokens(id) {
        reads++;
        return reads === 2 ? stale : store.getTokens(id);
      },
      acquireLock: async (name, ttlMs) =>
        saved ? store.acquireLock(name, ttlMs) : null,
    };
    const a = getAccessToken({
      store: first,
      accountId: "acc",
      now: () => NOW,
      refresh,
    });
    const sleep = vi.fn(async () => {
      openRefresh();
      await a;
    });
    const b = getAccessToken({
      store: second,
      accountId: "acc",
      now: () => NOW,
      refresh,
      sleep,
    });
    expect(await a).toBe("new-a");
    expect(await b).toBe("new-a");
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(reads).toBe(3);
  });

  it("saves the new pair before releasing the lock", async () => {
    await store.putTokens("acc", stale);
    const atRelease: (TokenSet | null)[] = [];
    const watched: Store = {
      ...store,
      async releaseLock(name, token) {
        atRelease.push(await store.getTokens("acc"));
        await store.releaseLock(name, token);
      },
    };
    const token = await getAccessToken({
      store: watched,
      accountId: "acc",
      now: () => NOW,
      refresh: async () => renewed,
    });
    expect(token).toBe("new-a");
    expect(atRelease).toEqual([renewed]);
  });

  it("throws TokenBusyError when the lock stays held", async () => {
    await store.putTokens("acc", stale);
    await store.acquireLock("refresh:acc", 60_000);
    const sleep = vi.fn(async () => {});
    const refresh = vi.fn();
    await expect(
      getAccessToken({
        store,
        accountId: "acc",
        now: () => NOW,
        refresh,
        sleep,
      }),
    ).rejects.toBeInstanceOf(TokenBusyError);
    expect(sleep).toHaveBeenCalledTimes(10);
    expect(sleep).toHaveBeenCalledWith(500);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("marks the account for re-auth on invalid_grant", async () => {
    await store.putTokens("acc", stale);
    const refresh = vi.fn(async () => {
      throw new OAuthError("invalid_grant");
    });
    const error = await getAccessToken({
      store,
      accountId: "acc",
      now: () => NOW,
      refresh,
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BufferError);
    expect((error as BufferError).kind).toBe("auth");
    expect((await store.getAccount("acc"))?.status).toBe("needs_reauth");
    expect(await store.acquireLock("refresh:acc", 1000)).not.toBeNull();
  });
});
