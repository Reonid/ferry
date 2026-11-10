import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as authServerGET } from "@/app/.well-known/oauth-authorization-server/route";
import { GET as resourceRootGET } from "@/app/.well-known/oauth-protected-resource/route";
import { GET as resourceGET } from "@/app/.well-known/oauth-protected-resource/mcp/route";
import { POST as registerPOST } from "@/app/api/oauth/register/route";
import { POST as tokenPOST } from "@/app/api/oauth/token/route";
import {
  DELETE as mcpDELETE,
  GET as mcpGET,
  OPTIONS as mcpOPTIONS,
  POST as mcpPOST,
} from "@/app/mcp/route";
import { createPkcePair } from "@/lib/auth/pkce";
import { loadKey } from "@/lib/crypto";
import { seedDevAccount } from "@/lib/dev/seed";
import { checkAuthorizationRequest } from "@/lib/oauth/authorize";
import { oauthContext } from "@/lib/oauth/http";
import { issueCode } from "@/lib/oauth/tokens";
import { getStore } from "@/lib/store";

const BASE = "https://ferry.example";
const MCP = `${BASE}/mcp`;
const CLAUDE = "https://claude.ai/api/mcp/auth_callback";
const KEY = randomBytes(32).toString("base64");

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_BASE_URL", BASE);
  vi.stubEnv("ENCRYPTION_KEY", KEY);
  // Never a real database: getStore falls back to the in-memory one.
  for (const name of [
    "UPSTASH_REDIS_REST_URL",
    "UPSTASH_REDIS_REST_TOKEN",
    "KV_REST_API_URL",
    "KV_REST_API_TOKEN",
  ])
    vi.stubEnv(name, "");
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function register(metadata: Record<string, unknown>) {
  const res = await registerPOST(
    new Request(`${BASE}/api/oauth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(metadata),
    }),
  );
  return { status: res.status, body: await res.json() };
}

function tokenRequest(
  fields: Record<string, string>,
  headers: Record<string, string> = {},
) {
  return tokenPOST(
    new Request(`${BASE}/api/oauth/token`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        ...headers,
      },
      body: new URLSearchParams(fields).toString(),
    }),
  );
}

/** What the consent screen does on Allow, without the screen. */
async function approve(clientId: string, accountId: string) {
  const { verifier, challenge } = createPkcePair();
  const check = checkAuthorizationRequest(
    new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: CLAUDE,
      code_challenge: challenge,
      code_challenge_method: "S256",
      resource: MCP,
    }),
    { key: loadKey(KEY), issuer: BASE, resource: MCP },
  );
  if (!check.ok) throw new Error("request refused");
  return {
    code: await issueCode(oauthContext(), accountId, check.request),
    verifier,
  };
}

async function connect() {
  const accountId = await seedDevAccount(getStore(), Date.now());
  const { body: client } = await register({
    client_name: "Claude",
    redirect_uris: [CLAUDE],
    token_endpoint_auth_method: "none",
  });
  const { code, verifier } = await approve(client.client_id, accountId);
  const res = await tokenRequest({
    grant_type: "authorization_code",
    client_id: client.client_id,
    code,
    code_verifier: verifier,
    redirect_uri: CLAUDE,
    resource: MCP,
  });
  expect(res.status).toBe(200);
  expect(res.headers.get("cache-control")).toBe("no-store");
  const tokens = (await res.json()) as {
    access_token: string;
    refresh_token: string;
  };
  return { accountId, clientId: client.client_id as string, tokens };
}

function mcp(
  token: string | null,
  message: unknown,
  headers: Record<string, string> = {},
) {
  return mcpPOST(
    new Request(MCP, {
      method: "POST",
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2025-11-25",
        ...headers,
      },
      body: typeof message === "string" ? message : JSON.stringify(message),
    }),
  );
}

describe("discovery", () => {
  it("serves the resource metadata at both well-known paths", async () => {
    for (const handler of [resourceGET, resourceRootGET]) {
      const res = handler();
      expect(res.headers.get("access-control-allow-origin")).toBe("*");
      expect(await res.json()).toMatchObject({
        resource: MCP,
        authorization_servers: [BASE],
      });
    }
  });

  it("serves the authorization server metadata", async () => {
    expect(await authServerGET().json()).toMatchObject({
      issuer: BASE,
      registration_endpoint: `${BASE}/api/oauth/register`,
      code_challenge_methods_supported: ["S256"],
    });
  });
});

describe("registration", () => {
  it("registers a client with 201", async () => {
    const { status, body } = await register({
      client_name: "Claude",
      redirect_uris: [CLAUDE],
      token_endpoint_auth_method: "none",
    });
    expect(status).toBe(201);
    expect(body).toMatchObject({
      client_name: "Claude",
      redirect_uris: [CLAUDE],
    });
  });

  it("answers bad registrations with RFC 7591 errors", async () => {
    expect(
      await register({ redirect_uris: ["http://evil.example/cb"] }),
    ).toEqual({
      status: 400,
      body: {
        error: "invalid_redirect_uri",
        error_description: expect.any(String),
      },
    });
    const notJson = await registerPOST(
      new Request(`${BASE}/api/oauth/register`, { method: "POST", body: "{" }),
    );
    expect(notJson.status).toBe(400);
    const huge = await registerPOST(
      new Request(`${BASE}/api/oauth/register`, {
        method: "POST",
        body: JSON.stringify({ client_name: "x".repeat(20_000) }),
      }),
    );
    expect(huge.status).toBe(413);
  });
});

describe("/mcp", () => {
  it("answers a request without a token with the 401 that starts sign-in", async () => {
    const res = await mcp(null, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
    });
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe(
      `Bearer realm="Ferry", resource_metadata="${BASE}/.well-known/oauth-protected-resource/mcp", scope="ferry:read ferry:write"`,
    );
    expect(res.headers.get("access-control-expose-headers")).toContain(
      "WWW-Authenticate",
    );
  });

  it("says invalid_token for a token Ferry doesn't know", async () => {
    const res = await mcp("ferry_at_made-up", {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    });
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain(
      'error="invalid_token"',
    );
  });

  it("speaks MCP to a connected app", async () => {
    const { tokens } = await connect();
    const init = await mcp(
      tokens.access_token,
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "test", version: "1" },
        },
      },
      { "mcp-protocol-version": "" },
    );
    expect(init.status).toBe(200);
    expect(init.headers.get("mcp-session-id")).toBeNull();
    expect((await init.json()).result).toMatchObject({
      protocolVersion: "2025-06-18",
      serverInfo: { name: "ferry", title: "Ferry" },
    });

    const initialized = await mcp(tokens.access_token, {
      jsonrpc: "2.0",
      method: "notifications/initialized",
    });
    expect(initialized.status).toBe(202);
    expect(await initialized.text()).toBe("");

    const list = await mcp(tokens.access_token, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
    });
    expect(
      (await list.json()).result.tools.map((t: { name: string }) => t.name),
    ).toEqual(["get_overview", "list_activity", "list_reddit_drafts"]);

    const call = await mcp(tokens.access_token, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "get_overview", arguments: {} },
    });
    const result = (await call.json()).result;
    expect(result.structuredContent).toMatchObject({
      account: { name: "Ferry Dev" },
      dashboardUrl: `${BASE}/app`,
    });
  });

  it("allows only POST once connected", async () => {
    const { tokens } = await connect();
    for (const handler of [mcpGET, mcpDELETE]) {
      const res = await handler(
        new Request(MCP, {
          headers: { authorization: `Bearer ${tokens.access_token}` },
        }),
      );
      expect(res.status).toBe(405);
      expect(res.headers.get("allow")).toBe("POST, OPTIONS");
    }
    const preflight = mcpOPTIONS();
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-headers")).toContain(
      "Authorization",
    );
  });

  it("refuses a body over 64 KB", async () => {
    const { tokens } = await connect();
    const res = await mcp(tokens.access_token, "x".repeat(70_000));
    expect(res.status).toBe(413);
  });

  it("stops answering once the account is deleted", async () => {
    const { tokens, accountId } = await connect();
    await getStore().deleteAccountData(accountId);
    const res = await mcp(tokens.access_token, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    });
    expect(res.status).toBe(401);
  });
});

describe("/api/oauth/token", () => {
  it("refreshes, and the old access token stops working", async () => {
    const { tokens, clientId } = await connect();
    const res = await tokenRequest({
      grant_type: "refresh_token",
      client_id: clientId,
      refresh_token: tokens.refresh_token,
    });
    expect(res.status).toBe(200);
    const next = await res.json();
    const ping = { jsonrpc: "2.0", id: 1, method: "ping" };
    expect((await mcp(tokens.access_token, ping)).status).toBe(401);
    expect((await mcp(next.access_token, ping)).status).toBe(200);
  });

  it("takes a JSON body too", async () => {
    const { tokens, clientId } = await connect();
    const res = await tokenPOST(
      new Request(`${BASE}/api/oauth/token`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          grant_type: "refresh_token",
          client_id: clientId,
          refresh_token: tokens.refresh_token,
        }),
      }),
    );
    expect(res.status).toBe(200);
  });

  it("answers errors as OAuth JSON, with a Basic challenge after Basic", async () => {
    const bad = await tokenRequest({ grant_type: "password" });
    expect(bad.status).toBe(401);
    expect(await bad.json()).toMatchObject({ error: "invalid_client" });
    const basic = await tokenRequest(
      { grant_type: "authorization_code" },
      {
        authorization: `Basic ${Buffer.from("c1.a.b:nope").toString("base64")}`,
      },
    );
    expect(basic.status).toBe(401);
    expect(basic.headers.get("www-authenticate")).toBe('Basic realm="Ferry"');
  });
});
