import { beforeEach, describe, expect, it } from "vitest";
import { createPkcePair } from "../auth/pkce";
import type { OAuthClient } from "./clients";
import { consentBinding, decideConsent } from "./consent";
import { tokenRequest } from "./tokens";
import { BASE, CLAUDE_CALLBACK, oauthFixture, RESOURCE } from "./test-support";

let fx: ReturnType<typeof oauthFixture>;
let claude: OAuthClient;
const pkce = createPkcePair();

beforeEach(async () => {
  fx = oauthFixture();
  await fx.account("acct");
  claude = fx.client({
    client_name: "Claude",
    redirect_uris: [CLAUDE_CALLBACK],
    token_endpoint_auth_method: "none",
  }).client;
});

function params(over: Record<string, string> = {}): URLSearchParams {
  return new URLSearchParams({
    response_type: "code",
    client_id: claude.clientId,
    redirect_uri: CLAUDE_CALLBACK,
    code_challenge: pkce.challenge,
    code_challenge_method: "S256",
    state: "st",
    resource: RESOURCE,
    ...over,
  });
}

const decide = (over: Partial<Parameters<typeof decideConsent>[0]> = {}) =>
  decideConsent({
    ctx: fx.ctx(),
    origin: BASE,
    accountId: "acct",
    binding: consentBinding(fx.key, "acct"),
    params: params(),
    allow: true,
    write: false,
    ...over,
  });

/** The scope of the tokens an answer's code trades for. */
async function grantedScope(
  over: Partial<Parameters<typeof decideConsent>[0]>,
): Promise<string> {
  const url = location(await decide(over));
  const tokens = await tokenRequest(
    fx.ctx(),
    new URLSearchParams({
      grant_type: "authorization_code",
      client_id: claude.clientId,
      code: url.searchParams.get("code") ?? "",
      code_verifier: pkce.verifier,
      redirect_uri: CLAUDE_CALLBACK,
    }),
    null,
  );
  if (!tokens.ok) throw new Error(tokens.body.error);
  return tokens.body.scope;
}

function location(result: Awaited<ReturnType<typeof decideConsent>>): URL {
  if (result.status !== 303) throw new Error(`got ${result.status}`);
  return new URL(result.location);
}

describe("decideConsent", () => {
  it("sends Allow back to the app with a code that works", async () => {
    const url = location(await decide());
    expect(url.origin + url.pathname).toBe(CLAUDE_CALLBACK);
    expect(url.searchParams.get("state")).toBe("st");
    expect(url.searchParams.get("iss")).toBe(BASE);
    const code = url.searchParams.get("code") ?? "";
    const tokens = await tokenRequest(
      fx.ctx(),
      new URLSearchParams({
        grant_type: "authorization_code",
        client_id: claude.clientId,
        code,
        code_verifier: pkce.verifier,
        redirect_uri: CLAUDE_CALLBACK,
      }),
      null,
    );
    expect(tokens.ok).toBe(true);
  });

  it("lets the app make changes only when the owner ticks the box", async () => {
    const asks = params({ scope: "ferry:read ferry:write" });
    expect(await grantedScope({ params: asks, write: true })).toBe(
      "ferry:read ferry:write",
    );
    expect(await grantedScope({ params: asks, write: false })).toBe(
      "ferry:read",
    );
    // A tick sent for an app that only asked to read adds nothing.
    expect(
      await grantedScope({
        params: params({ scope: "ferry:read" }),
        write: true,
      }),
    ).toBe("ferry:read");
  });

  it("sends Cancel back as access_denied", async () => {
    const url = location(await decide({ allow: false }));
    expect(url.searchParams.get("error")).toBe("access_denied");
    expect(url.searchParams.get("state")).toBe("st");
    expect(url.searchParams.has("code")).toBe(false);
  });

  it("refuses an answer from any other page", async () => {
    for (const origin of [null, "https://evil.example", "http://ferry.example"])
      expect(await decide({ origin }), String(origin)).toEqual({
        status: 403,
        message: expect.any(String),
      });
  });

  it("asks a signed-out owner to sign in first", async () => {
    for (const accountId of [null, "deleted-account"]) {
      const url = location(await decide({ accountId }));
      expect(url.origin + url.pathname).toBe(`${BASE}/oauth/authorize`);
      expect(url.searchParams.get("client_id")).toBe(claude.clientId);
    }
  });

  it("asks again when another account signed in after the screen was shown", async () => {
    await fx.account("other");
    for (const binding of [null, "", consentBinding(fx.key, "other")]) {
      const url = location(await decide({ binding }));
      expect(url.pathname, String(binding)).toBe("/oauth/authorize");
      expect(url.searchParams.has("code")).toBe(false);
    }
  });

  it("checks the request again", async () => {
    expect(
      await decide({
        params: params({ redirect_uri: "https://evil.example/cb" }),
      }),
    ).toEqual({ status: 400, message: expect.any(String) });
    const url = location(
      await decide({ params: params({ code_challenge_method: "plain" }) }),
    );
    expect(url.searchParams.get("error")).toBe("invalid_request");
  });
});
