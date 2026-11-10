import { describe, expect, it } from "vitest";
import { createPkcePair } from "../auth/pkce";
import { authorizationRedirect, checkAuthorizationRequest } from "./authorize";
import { BASE, CLAUDE_CALLBACK, oauthFixture, RESOURCE } from "./test-support";

const { key, client } = oauthFixture();
const claude = client({
  client_name: "Claude",
  redirect_uris: [CLAUDE_CALLBACK],
  token_endpoint_auth_method: "none",
}).client;
const { challenge } = createPkcePair();
const ctx = { key, issuer: BASE, resource: RESOURCE };

function params(over: Record<string, string | null> = {}): URLSearchParams {
  const base: Record<string, string | null> = {
    response_type: "code",
    client_id: claude.clientId,
    redirect_uri: CLAUDE_CALLBACK,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: "xyz",
    scope: "ferry:read",
    resource: RESOURCE,
    ...over,
  };
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(base)) if (v !== null) p.set(k, v);
  return p;
}

/** The error a check sent back to the app, as a parsed URL. */
function redirected(check: ReturnType<typeof checkAuthorizationRequest>): URL {
  if (check.ok || check.redirect === null)
    throw new Error("expected a redirect");
  return new URL(check.redirect);
}

describe("checkAuthorizationRequest", () => {
  it("accepts a well-formed request", () => {
    const check = checkAuthorizationRequest(params(), ctx);
    expect(check).toEqual({
      ok: true,
      request: {
        client: claude,
        redirectUri: CLAUDE_CALLBACK,
        redirectUriSent: true,
        state: "xyz",
        codeChallenge: challenge,
        scope: "ferry:read",
      },
    });
  });

  it("fills in the redirect URI only when the app registered one", () => {
    const check = checkAuthorizationRequest(
      params({ redirect_uri: null }),
      ctx,
    );
    expect(check).toMatchObject({
      ok: true,
      request: { redirectUri: CLAUDE_CALLBACK, redirectUriSent: false },
    });
    const two = client({
      redirect_uris: [
        CLAUDE_CALLBACK,
        "https://claude.com/api/mcp/auth_callback",
      ],
      token_endpoint_auth_method: "none",
    }).client;
    expect(
      checkAuthorizationRequest(
        params({ client_id: two.clientId, redirect_uri: null }),
        ctx,
      ),
    ).toMatchObject({ ok: false, redirect: null });
  });

  it("keeps errors on the page when the app or its redirect is unknown", () => {
    const unknown: Record<string, string | null>[] = [
      { client_id: null },
      { client_id: "c1.forged.sig" },
      { redirect_uri: "https://evil.example/cb" },
      { redirect_uri: `${CLAUDE_CALLBACK}/extra` },
    ];
    for (const over of unknown) {
      const check = checkAuthorizationRequest(params(over), ctx);
      expect(check, JSON.stringify(over)).toMatchObject({
        ok: false,
        redirect: null,
        message: expect.any(String),
      });
    }
    const p = params();
    p.append("redirect_uri", CLAUDE_CALLBACK);
    expect(checkAuthorizationRequest(p, ctx)).toMatchObject({
      ok: false,
      redirect: null,
    });
  });

  it("lets a loopback redirect pick its port", () => {
    const cli = client({
      redirect_uris: ["http://localhost:3118/callback"],
      token_endpoint_auth_method: "none",
    }).client;
    const check = checkAuthorizationRequest(
      params({
        client_id: cli.clientId,
        redirect_uri: "http://localhost:50123/callback",
      }),
      ctx,
    );
    expect(check).toMatchObject({
      ok: true,
      request: { redirectUri: "http://localhost:50123/callback" },
    });
  });

  it("sends other errors back to the app with state and iss", () => {
    const cases: [Record<string, string | null>, string][] = [
      [{ response_type: "token" }, "unsupported_response_type"],
      [{ response_type: null }, "unsupported_response_type"],
      [{ code_challenge_method: null }, "invalid_request"],
      [{ code_challenge_method: "plain" }, "invalid_request"],
      [{ code_challenge: null }, "invalid_request"],
      [{ code_challenge: "short" }, "invalid_request"],
      [{ resource: "https://other.example/mcp" }, "invalid_target"],
      [{ resource: `${BASE}/elsewhere` }, "invalid_target"],
    ];
    for (const [over, error] of cases) {
      const url = redirected(checkAuthorizationRequest(params(over), ctx));
      expect(url.origin + url.pathname, JSON.stringify(over)).toBe(
        CLAUDE_CALLBACK,
      );
      expect(url.searchParams.get("error"), JSON.stringify(over)).toBe(error);
      expect(url.searchParams.get("state")).toBe("xyz");
      expect(url.searchParams.get("iss")).toBe(BASE);
      expect(url.searchParams.get("error_description")).toEqual(
        expect.any(String),
      );
    }
  });

  it("refuses parameters sent twice", () => {
    for (const name of ["response_type", "code_challenge", "state", "scope"]) {
      const p = params();
      p.append(name, "again");
      const url = redirected(checkAuthorizationRequest(p, ctx));
      expect(url.searchParams.get("error"), name).toBe("invalid_request");
    }
  });

  it("refuses an over-long state", () => {
    const url = redirected(
      checkAuthorizationRequest(params({ state: "s".repeat(3000) }), ctx),
    );
    expect(url.searchParams.get("error")).toBe("invalid_request");
    expect(url.searchParams.has("state")).toBe(false);
  });

  it("takes the resource with a trailing slash, or none at all", () => {
    expect(
      checkAuthorizationRequest(params({ resource: `${RESOURCE}/` }), ctx).ok,
    ).toBe(true);
    expect(checkAuthorizationRequest(params({ resource: null }), ctx).ok).toBe(
      true,
    );
  });

  it("grants ferry:read whatever scope is asked for", () => {
    for (const scope of [null, "", "openid offline_access", "ferry:read"]) {
      expect(
        checkAuthorizationRequest(params({ scope }), ctx),
        String(scope),
      ).toMatchObject({ ok: true, request: { scope: "ferry:read" } });
    }
  });

  it("works without state", () => {
    expect(
      checkAuthorizationRequest(params({ state: null }), ctx),
    ).toMatchObject({ ok: true, request: { state: null } });
  });
});

describe("authorizationRedirect", () => {
  it("keeps the redirect URI's own query and skips nulls", () => {
    const url = new URL(
      authorizationRedirect("https://app.example/cb?tenant=7", {
        code: "abc",
        state: null,
        iss: BASE,
      }),
    );
    expect(url.searchParams.get("tenant")).toBe("7");
    expect(url.searchParams.get("code")).toBe("abc");
    expect(url.searchParams.has("state")).toBe(false);
    expect(url.searchParams.get("iss")).toBe(BASE);
  });
});
