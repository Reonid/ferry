import { describe, expect, it, vi } from "vitest";
import {
  bufferAuthorizeUrl,
  exchangeBufferCode,
  OAuthError,
  refreshBufferToken,
} from "./buffer-oauth";
import { createPkcePair } from "./pkce";

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const exchange = (fetchImpl: typeof fetch) =>
  exchangeBufferCode({
    clientId: "cid",
    clientSecret: "secret",
    code: "code1",
    redirectUri: "https://ferry.test/api/auth/buffer/callback",
    codeVerifier: "verifier1",
    now: 1_000_000,
    fetchImpl,
  });

describe("buffer oauth", () => {
  it("builds a read-only PKCE authorize URL", () => {
    const { challenge } = createPkcePair();
    const url = new URL(
      bufferAuthorizeUrl({
        clientId: "cid",
        redirectUri: "https://ferry.test/api/auth/buffer/callback",
        state: "st",
        codeChallenge: challenge,
      }),
    );
    expect(url.origin + url.pathname).toBe("https://auth.buffer.com/auth");
    const p = url.searchParams;
    expect(p.get("scope")).toBe("account:read posts:read offline_access");
    expect(p.get("code_challenge")).toBe(challenge);
    expect(p.get("code_challenge_method")).toBe("S256");
    expect(p.get("response_type")).toBe("code");
    expect(p.get("prompt")).toBe("consent");
    expect(p.get("client_id")).toBe("cid");
    expect(p.get("state")).toBe("st");
  });

  it("computes expiresAt from expires_in", async () => {
    const fetchImpl = vi.fn(async () =>
      json({
        access_token: "a",
        refresh_token: "r",
        token_type: "bearer",
        expires_in: 3600,
      }),
    );
    const tokens = await exchange(fetchImpl as unknown as typeof fetch);
    expect(tokens).toEqual({
      accessToken: "a",
      refreshToken: "r",
      expiresAt: 1_000_000 + 3600 * 1000,
    });
    const body = new URLSearchParams(
      (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1]
        .body as URLSearchParams,
    );
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code_verifier")).toBe("verifier1");
  });

  it("sends a refresh grant", async () => {
    const fetchImpl = vi.fn(async () =>
      json({ access_token: "a2", refresh_token: "r2", expires_in: 60 }),
    );
    const tokens = await refreshBufferToken({
      clientId: "cid",
      clientSecret: "secret",
      refreshToken: "r1",
      now: 5,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(tokens.expiresAt).toBe(5 + 60_000);
    const init = (
      fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    )[1];
    const body = new URLSearchParams(init.body as URLSearchParams);
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("r1");
  });

  it("rejects token responses without a refresh token", async () => {
    const fetchImpl = (async () =>
      json({ access_token: "a", expires_in: 3600 })) as unknown as typeof fetch;
    await expect(exchange(fetchImpl)).rejects.toMatchObject({
      name: "OAuthError",
      code: "bad_response",
    });
  });

  it("surfaces invalid_grant", async () => {
    const fetchImpl = (async () =>
      json(
        { error: "invalid_grant", error_description: "revoked" },
        400,
      )) as unknown as typeof fetch;
    const error = await exchange(fetchImpl).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(OAuthError);
    expect((error as OAuthError).code).toBe("invalid_grant");
  });
});
