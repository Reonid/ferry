import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  checkClientSecret,
  readClient,
  redirectUriAllowed,
  registerClient,
  validRedirectUri,
  type OAuthClient,
} from "./clients";

const key = randomBytes(32);
const NOW = Date.UTC(2026, 10, 10, 12, 0, 0);
const CLAUDE = "https://claude.ai/api/mcp/auth_callback";

function register(metadata: unknown): OAuthClient {
  const result = registerClient(metadata, key, NOW);
  if (!result.ok) throw new Error(result.description);
  return result.client;
}

describe("registerClient", () => {
  it("signs a public client into its ID and reads it back", () => {
    const result = registerClient(
      {
        client_name: "Claude",
        redirect_uris: [CLAUDE],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
      },
      key,
      NOW,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.clientSecret).toBeNull();
    expect(result.client.clientId).toMatch(/^c1\.[\w-]+\.[\w-]+$/);
    expect(readClient(result.client.clientId, key)).toEqual(result.client);
    expect(result.response).toEqual({
      client_id: result.client.clientId,
      client_id_issued_at: NOW / 1000,
      client_name: "Claude",
      redirect_uris: [CLAUDE],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    });
  });

  it("defaults to client_secret_basic, as RFC 7591 does, and issues a secret", () => {
    const result = registerClient({ redirect_uris: [CLAUDE] }, key, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.client.authMethod).toBe("client_secret_basic");
    expect(result.clientSecret).toEqual(expect.any(String));
    expect(result.response).toMatchObject({
      client_secret: result.clientSecret,
      client_secret_expires_at: 0,
      token_endpoint_auth_method: "client_secret_basic",
    });
    const id = result.client.clientId;
    expect(checkClientSecret(id, result.clientSecret ?? "", key)).toBe(true);
    expect(checkClientSecret(id, "wrong", key)).toBe(false);
    expect(checkClientSecret(id, "", key)).toBe(false);
  });

  it("gives every client its own secret", () => {
    const a = registerClient(
      {
        redirect_uris: [CLAUDE],
        token_endpoint_auth_method: "client_secret_post",
      },
      key,
      NOW,
    );
    const b = registerClient(
      {
        redirect_uris: [CLAUDE],
        token_endpoint_auth_method: "client_secret_post",
      },
      key,
      NOW + 1000,
    );
    if (!a.ok || !b.ok) throw new Error("registration failed");
    expect(a.client.clientId).not.toBe(b.client.clientId);
    expect(
      checkClientSecret(a.client.clientId, b.clientSecret ?? "", key),
    ).toBe(false);
  });

  it("refuses metadata that isn't an object", () => {
    for (const metadata of [null, "x", 3, [CLAUDE]]) {
      const result = registerClient(metadata, key, NOW);
      expect(result).toMatchObject({
        ok: false,
        error: "invalid_client_metadata",
      });
    }
  });

  it("refuses missing or unusable redirect URIs", () => {
    const bad: unknown[] = [
      undefined,
      [],
      "https://claude.ai/cb",
      [3],
      Array.from({ length: 6 }, (_, i) => `https://a.example/${i}`),
      [`https://a.example/${"x".repeat(520)}`],
      ["https://a.example/cb#frag"],
      ["https://user:pw@a.example/cb"],
      ["http://a.example/cb"],
      ["ftp://a.example/cb"],
      ["javascript:alert(1)"],
      ["cursor://anysphere/cb"],
      ["not a url"],
      ["/relative"],
    ];
    for (const redirect_uris of bad) {
      const result = registerClient({ redirect_uris }, key, NOW);
      expect(result, JSON.stringify(redirect_uris)).toMatchObject({
        ok: false,
        error: "invalid_redirect_uri",
      });
    }
  });

  it("accepts https anywhere and http only on loopback", () => {
    for (const uri of [
      "https://chatgpt.com/connector_platform_oauth_redirect",
      "https://a.example/cb?x=1",
      "http://localhost:3118/callback",
      "http://127.0.0.1/callback",
      "http://[::1]:9000/cb",
    ]) {
      expect(register({ redirect_uris: [uri] }).redirectUris).toEqual([uri]);
    }
  });

  it("refuses grant and response types Ferry doesn't do", () => {
    for (const metadata of [
      { grant_types: ["client_credentials"] },
      { grant_types: ["authorization_code", "implicit"] },
      { grant_types: "authorization_code" },
      { response_types: ["token"] },
      { token_endpoint_auth_method: "private_key_jwt" },
    ]) {
      const result = registerClient(
        { redirect_uris: [CLAUDE], ...metadata },
        key,
        NOW,
      );
      expect(result, JSON.stringify(metadata)).toMatchObject({
        ok: false,
        error: "invalid_client_metadata",
      });
    }
  });

  it("cleans the name and keeps it short", () => {
    expect(register({ redirect_uris: [CLAUDE] }).name).toBeNull();
    expect(register({ redirect_uris: [CLAUDE], client_name: "  " }).name).toBe(
      null,
    );
    expect(
      register({ redirect_uris: [CLAUDE], client_name: " Chat\u0000GPT\n " })
        .name,
    ).toBe("ChatGPT");
    // Bidi overrides could make a name read as something else.
    expect(
      register({ redirect_uris: [CLAUDE], client_name: "‮edualC" }).name,
    ).toBe("edualC");
    expect(
      register({ redirect_uris: [CLAUDE], client_name: "x".repeat(200) }).name,
    ).toHaveLength(80);
    expect(register({ redirect_uris: [CLAUDE], client_name: 7 }).name).toBe(
      null,
    );
  });
});

describe("readClient", () => {
  const client = register({
    client_name: "Claude",
    redirect_uris: [CLAUDE],
    token_endpoint_auth_method: "none",
  });

  it("rejects a changed payload or signature", () => {
    const [prefix, payload, sig] = client.clientId.split(".");
    const forged = Buffer.from(
      JSON.stringify({
        n: "Claude",
        r: ["https://evil.example/cb"],
        m: "none",
        t: NOW / 1000,
      }),
    ).toString("base64url");
    expect(readClient(`${prefix}.${forged}.${sig}`, key)).toBeNull();
    const flipped = (sig?.[0] === "A" ? "B" : "A") + (sig ?? "").slice(1);
    expect(readClient(`${prefix}.${payload}.${flipped}`, key)).toBeNull();
    expect(readClient(`c2.${payload}.${sig}`, key)).toBeNull();
  });

  it("rejects another key's clients and junk", () => {
    expect(readClient(client.clientId, randomBytes(32))).toBeNull();
    for (const junk of ["", "c1", "c1..", "c1.a.b.c", "x".repeat(5000)])
      expect(readClient(junk, key)).toBeNull();
  });
});

describe("redirect URIs", () => {
  it("matches registered URIs exactly", () => {
    const client = register({ redirect_uris: [CLAUDE] });
    expect(redirectUriAllowed(client, CLAUDE)).toBe(true);
    expect(redirectUriAllowed(client, `${CLAUDE}/`)).toBe(false);
    expect(redirectUriAllowed(client, `${CLAUDE}?x=1`)).toBe(false);
    expect(
      redirectUriAllowed(
        client,
        "https://claude.ai:8443/api/mcp/auth_callback",
      ),
    ).toBe(false);
  });

  it("lets loopback URIs use any port, as RFC 8252 asks", () => {
    const client = register({
      redirect_uris: ["http://localhost:3118/callback", "http://127.0.0.1/cb"],
    });
    expect(redirectUriAllowed(client, "http://localhost:51234/callback")).toBe(
      true,
    );
    expect(redirectUriAllowed(client, "http://127.0.0.1:8080/cb")).toBe(true);
    expect(redirectUriAllowed(client, "http://localhost:51234/other")).toBe(
      false,
    );
    expect(redirectUriAllowed(client, "http://127.0.0.1:8080/callback")).toBe(
      false,
    );
    expect(redirectUriAllowed(client, "https://localhost:3118/callback")).toBe(
      false,
    );
  });

  it("knows a usable redirect URI", () => {
    expect(validRedirectUri(CLAUDE)).toBe(true);
    expect(validRedirectUri("http://claude.ai/cb")).toBe(false);
  });
});
