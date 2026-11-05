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
