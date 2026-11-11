import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MCP_ACCESS_TTL_S,
  MCP_GRANT_TTL_S,
  OAUTH_CODE_TTL_S,
} from "@/lib/constants";
import type { McpAccess, McpGrant, OAuthCode } from "@/lib/types";
import { createFakeRedis } from "./fake-redis";
import type { RedisLike } from "./redis-like";
import { createStore, type Store } from "./store";

let redis: RedisLike;
let store: Store;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
  redis = createFakeRedis();
  store = createStore(redis, randomBytes(32));
});
afterEach(() => vi.useRealTimers());

const code: OAuthCode = {
  accountId: "a",
  clientId: "c1.x.y",
  clientName: "Claude",
  redirectUri: "https://claude.ai/api/mcp/auth_callback",
  redirectUriSent: true,
  codeChallenge: "challenge",
  scope: "ferry:read",
  resource: "https://ferry.example/mcp",
  createdAt: 1_000_000,
};

const grant = (id: string, accountId = "a", createdAt = 1): McpGrant => ({
  id,
  accountId,
  clientId: "c1.x.y",
  clientName: "Claude",
  redirectHost: "claude.ai",
  scope: "ferry:read",
  resource: "https://ferry.example/mcp",
  createdAt,
  refreshedAt: createdAt,
  accessHash: `access-${id}`,
  refreshHash: `refresh-${id}`,
});

const access = (grantId: string, accountId = "a"): McpAccess => ({
  grantId,
  accountId,
  scope: "ferry:read",
  resource: "https://ferry.example/mcp",
  expiresAt: 1_000_000 + MCP_ACCESS_TTL_S * 1000,
});

async function connect(g: McpGrant): Promise<void> {
  await store.putGrant(g);
  await store.putAccessToken(g.accessHash, access(g.id, g.accountId));
  await store.putRefreshToken(g.refreshHash, g.id);
}

describe("consent codes", () => {
  it("hands a code out once", async () => {
    await store.putOAuthCode("h", code);
    expect(await store.takeOAuthCode("h")).toEqual(code);
    expect(await store.takeOAuthCode("h")).toBeNull();
    expect(await store.takeOAuthCode("other")).toBeNull();
  });

  it("gives a code to only one of two requests that race for it", async () => {
    await store.putOAuthCode("h", code);
    const both = await Promise.all([
      store.takeOAuthCode("h"),
      store.takeOAuthCode("h"),
    ]);
    expect(both.filter((c) => c !== null)).toHaveLength(1);
  });

  it("expires codes after five minutes", async () => {
    await store.putOAuthCode("h", code);
    vi.advanceTimersByTime(OAUTH_CODE_TTL_S * 1000);
    expect(await store.takeOAuthCode("h")).toBeNull();
  });

  it("files codes under ferry:mcp", async () => {
    await store.putOAuthCode("h", code);
    expect(await redis.get("ferry:mcp:code:h")).not.toBeNull();
  });
});

describe("connections", () => {
  it("lists an account's connections, oldest first", async () => {
    await store.putGrant(grant("g2", "a", 20));
    await store.putGrant(grant("g1", "a", 10));
    await store.putGrant(grant("other", "b"));
    expect((await store.listGrants("a")).map((g) => g.id)).toEqual([
      "g1",
      "g2",
    ]);
    expect(await store.getGrant("g1")).toEqual(grant("g1", "a", 10));
  });

  it("forgets connections a month after their last refresh", async () => {
    await store.putGrant(grant("g1"));
    vi.advanceTimersByTime(MCP_GRANT_TTL_S * 1000 - 1000);
    await store.putGrant({ ...grant("g1"), refreshedAt: 2 });
    vi.advanceTimersByTime(2000);
    expect(await store.getGrant("g1")).not.toBeNull();
    vi.advanceTimersByTime(MCP_GRANT_TTL_S * 1000);
    expect(await store.getGrant("g1")).toBeNull();
    expect(await store.listGrants("a")).toEqual([]);
    expect(await redis.smembers("ferry:mcp:grants:a")).toEqual([]);
  });

  it("deletes a connection with both of its tokens", async () => {
    await connect(grant("g1"));
    await connect(grant("g2"));
    await store.deleteGrant(grant("g1"));
    expect(await store.getGrant("g1")).toBeNull();
    expect(await store.getAccessToken("access-g1")).toBeNull();
    expect(await store.takeRefreshToken("refresh-g1")).toBeNull();
    expect((await store.listGrants("a")).map((g) => g.id)).toEqual(["g2"]);
    expect(await store.getAccessToken("access-g2")).not.toBeNull();
  });
});

describe("MCP tokens", () => {
  it("keeps access tokens for an hour", async () => {
    await store.putAccessToken("h", access("g1"));
    expect(await store.getAccessToken("h")).toEqual(access("g1"));
    vi.advanceTimersByTime(MCP_ACCESS_TTL_S * 1000);
    expect(await store.getAccessToken("h")).toBeNull();
  });

  it("deletes an access token", async () => {
    await store.putAccessToken("h", access("g1"));
    await store.deleteAccessToken("h");
    expect(await store.getAccessToken("h")).toBeNull();
  });

  it("hands a refresh token's grant out once", async () => {
    await store.putRefreshToken("h", "g1");
    expect(await store.takeRefreshToken("h")).toBe("g1");
    expect(await store.takeRefreshToken("h")).toBeNull();
  });

  it("keeps refresh tokens as long as a connection", async () => {
    await store.putRefreshToken("h", "g1");
    vi.advanceTimersByTime(MCP_GRANT_TTL_S * 1000);
    expect(await store.takeRefreshToken("h")).toBeNull();
  });
});

describe("deleteAccountData and MCP", () => {
  it("disconnects every app and deletes their tokens", async () => {
    await connect(grant("g1"));
    await connect(grant("g2"));
    await connect(grant("other", "b"));
    await store.deleteAccountData("a");
    for (const id of ["g1", "g2"]) {
      expect(await store.getGrant(id)).toBeNull();
      expect(await store.getAccessToken(`access-${id}`)).toBeNull();
      expect(await store.takeRefreshToken(`refresh-${id}`)).toBeNull();
    }
    expect(await redis.smembers("ferry:mcp:grants:a")).toEqual([]);
    expect(await store.getGrant("other")).not.toBeNull();
    expect(await store.getAccessToken("access-other")).not.toBeNull();
  });
});

describe("replaceGrant", () => {
  it("rewrites a connection that exists, and refuses one that's gone", async () => {
    await store.putGrant(grant("g1"));
    expect(await store.replaceGrant({ ...grant("g1"), refreshedAt: 5 })).toBe(
      true,
    );
    expect((await store.getGrant("g1"))?.refreshedAt).toBe(5);
    await store.deleteGrant(grant("g1"));
    expect(await store.replaceGrant(grant("g1"))).toBe(false);
    expect(await store.getGrant("g1")).toBeNull();
    expect(await redis.smembers("ferry:mcp:grants:a")).toEqual([]);
  });
});

describe("spent-token markers", () => {
  it("keeps a spent refresh token as long as a connection", async () => {
    await store.markRefreshSpent("h", { grantId: "g1", at: 7 });
    expect(await store.getSpentRefresh("h")).toEqual({ grantId: "g1", at: 7 });
    expect(await redis.get("ferry:mcp:spent-refresh:h")).not.toBeNull();
    vi.advanceTimersByTime(MCP_GRANT_TTL_S * 1000);
    expect(await store.getSpentRefresh("h")).toBeNull();
  });

  it("keeps a used code's connection for as long as codes live", async () => {
    await store.markCodeSpent("h", "g1");
    expect(await store.getSpentCode("h")).toBe("g1");
    vi.advanceTimersByTime(OAUTH_CODE_TTL_S * 1000);
    expect(await store.getSpentCode("h")).toBeNull();
  });
});
