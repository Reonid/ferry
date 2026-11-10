import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPkcePair } from "../auth/pkce";
import { MCP_ACCESS_TTL_S, OAUTH_CODE_TTL_S } from "../constants";
import type { AuthorizationRequest } from "./authorize";
import type { OAuthClient } from "./clients";
import {
  checkAccessToken,
  issueCode,
  tokenRequest,
  type TokenResult,
} from "./tokens";
import { CLAUDE_CALLBACK, oauthFixture, RESOURCE } from "./test-support";

let fx: ReturnType<typeof oauthFixture>;
let claude: OAuthClient;

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.UTC(2026, 10, 10, 12));
  fx = oauthFixture();
  await fx.account("acct");
  claude = fx.client({
    client_name: "Claude",
    redirect_uris: [CLAUDE_CALLBACK],
    token_endpoint_auth_method: "none",
  }).client;
});
afterEach(() => vi.useRealTimers());

function request(
  client: OAuthClient,
  challenge: string,
  over: Partial<AuthorizationRequest> = {},
): AuthorizationRequest {
  return {
    client,
    redirectUri: client.redirectUris[0] ?? "",
    redirectUriSent: true,
    state: "s",
    codeChallenge: challenge,
    scope: "ferry:read",
    offerWrite: false,
    ...over,
  };
}

/** A fresh code for `client`, with its verifier. */
async function approve(
  client: OAuthClient = claude,
  over: Partial<AuthorizationRequest> = {},
  accountId = "acct",
) {
  const { verifier, challenge } = createPkcePair();
  const code = await issueCode(
    fx.ctx(),
    accountId,
    request(client, challenge, over),
  );
  return { code, verifier };
}

function form(fields: Record<string, string>): URLSearchParams {
  return new URLSearchParams(fields);
}

async function exchange(
  fields: Record<string, string>,
  authorization: string | null = null,
): Promise<TokenResult> {
  return tokenRequest(fx.ctx(), form(fields), authorization);
}

async function connect(client: OAuthClient = claude) {
  const { code, verifier } = await approve(client);
  const result = await exchange({
    grant_type: "authorization_code",
    client_id: client.clientId,
    code,
    code_verifier: verifier,
    redirect_uri: client.redirectUris[0] ?? "",
  });
  if (!result.ok) throw new Error(result.body.error);
  return result.body;
}

const errorOf = (r: TokenResult) => (r.ok ? null : r.body.error);

describe("authorization_code", () => {
  it("turns a code into a Bearer pair for the account", async () => {
    const body = await connect();
    expect(body).toEqual({
      access_token: expect.stringMatching(/^ferry_at_[\w-]{43}$/),
      token_type: "Bearer",
      expires_in: MCP_ACCESS_TTL_S,
      refresh_token: expect.stringMatching(/^ferry_rt_[\w-]{43}$/),
      scope: "ferry:read",
    });
    const check = await checkAccessToken(
      fx.ctx(),
      `Bearer ${body.access_token}`,
    );
    expect(check).toMatchObject({ ok: true, accountId: "acct" });
    const [grant] = await fx.store.listGrants("acct");
    expect(grant).toMatchObject({
      accountId: "acct",
      clientId: claude.clientId,
      clientName: "Claude",
      redirectHost: "claude.ai",
      scope: "ferry:read",
      resource: RESOURCE,
    });
  });

  it("uses each code once", async () => {
    const { code, verifier } = await approve();
    const fields = {
      grant_type: "authorization_code",
      client_id: claude.clientId,
      code,
      code_verifier: verifier,
      redirect_uri: CLAUDE_CALLBACK,
    };
    expect((await exchange(fields)).ok).toBe(true);
    expect(errorOf(await exchange(fields))).toBe("invalid_grant");
  });

  it("refuses a code after five minutes", async () => {
    const { code, verifier } = await approve();
    vi.advanceTimersByTime(OAUTH_CODE_TTL_S * 1000);
    expect(
      errorOf(
        await exchange({
          grant_type: "authorization_code",
          client_id: claude.clientId,
          code,
          code_verifier: verifier,
          redirect_uri: CLAUDE_CALLBACK,
        }),
      ),
    ).toBe("invalid_grant");
  });

  it("checks the verifier, the redirect URI and the client", async () => {
    const other = fx.client({
      redirect_uris: [CLAUDE_CALLBACK],
      token_endpoint_auth_method: "none",
    }).client;
    const cases: [Record<string, string>, string][] = [
      [{ code_verifier: createPkcePair().verifier }, "invalid_grant"],
      [{ code_verifier: "too-short" }, "invalid_request"],
      [{ redirect_uri: "https://claude.ai/elsewhere" }, "invalid_grant"],
      [{ client_id: other.clientId }, "invalid_grant"],
    ];
    for (const [over, error] of cases) {
      const { code, verifier } = await approve();
      const result = await exchange({
        grant_type: "authorization_code",
        client_id: claude.clientId,
        code,
        code_verifier: verifier,
        redirect_uri: CLAUDE_CALLBACK,
        ...over,
      });
      expect(errorOf(result), JSON.stringify(over)).toBe(error);
    }
  });

  it("needs the redirect URI only when the request named it", async () => {
    const named = await approve();
    expect(
      errorOf(
        await exchange({
          grant_type: "authorization_code",
          client_id: claude.clientId,
          code: named.code,
          code_verifier: named.verifier,
        }),
      ),
    ).toBe("invalid_grant");
    const unnamed = await approve(claude, { redirectUriSent: false });
    expect(
      (
        await exchange({
          grant_type: "authorization_code",
          client_id: claude.clientId,
          code: unnamed.code,
          code_verifier: unnamed.verifier,
        })
      ).ok,
    ).toBe(true);
  });

  it("refuses a code once the account is deleted", async () => {
    const { code, verifier } = await approve();
    await fx.store.deleteAccountData("acct");
    expect(
      errorOf(
        await exchange({
          grant_type: "authorization_code",
          client_id: claude.clientId,
          code,
          code_verifier: verifier,
          redirect_uri: CLAUDE_CALLBACK,
        }),
      ),
    ).toBe("invalid_grant");
    expect(await fx.store.listGrants("acct")).toEqual([]);
  });

  it("checks the resource, allowing a trailing slash", async () => {
    const bad = await approve();
    expect(
      errorOf(
        await exchange({
          grant_type: "authorization_code",
          client_id: claude.clientId,
          code: bad.code,
          code_verifier: bad.verifier,
          redirect_uri: CLAUDE_CALLBACK,
          resource: "https://other.example/mcp",
        }),
      ),
    ).toBe("invalid_target");
    const good = await approve();
    expect(
      (
        await exchange({
          grant_type: "authorization_code",
          client_id: claude.clientId,
          code: good.code,
          code_verifier: good.verifier,
          redirect_uri: CLAUDE_CALLBACK,
          resource: `${RESOURCE}/`,
        })
      ).ok,
    ).toBe(true);
  });

  it("keeps ten connections, dropping the oldest", async () => {
    const first = await connect();
    for (let i = 0; i < 10; i++) {
      vi.advanceTimersByTime(1000);
      await connect();
    }
    expect(await fx.store.listGrants("acct")).toHaveLength(10);
    expect(
      (await checkAccessToken(fx.ctx(), `Bearer ${first.access_token}`)).ok,
    ).toBe(false);
  });

  it("refuses other grant types and missing parameters", async () => {
    expect(
      errorOf(
        await exchange({
          grant_type: "client_credentials",
          client_id: claude.clientId,
        }),
      ),
    ).toBe("unsupported_grant_type");
    expect(
      errorOf(
        await exchange({
          grant_type: "authorization_code",
          client_id: claude.clientId,
        }),
      ),
    ).toBe("invalid_request");
  });
});

describe("client authentication", () => {
  async function confidential(
    method: "client_secret_basic" | "client_secret_post",
  ) {
    const registered = fx.client({
      client_name: "ChatGPT",
      redirect_uris: ["https://chatgpt.com/connector_platform_oauth_redirect"],
      token_endpoint_auth_method: method,
    });
    const { code, verifier } = await approve(registered.client);
    return { ...registered, code, verifier };
  }
  const basic = (id: string, secret: string) =>
    `Basic ${Buffer.from(`${encodeURIComponent(id)}:${encodeURIComponent(secret)}`).toString("base64")}`;

  it("takes a secret over HTTP Basic", async () => {
    const c = await confidential("client_secret_basic");
    const result = await exchange(
      {
        grant_type: "authorization_code",
        code: c.code,
        code_verifier: c.verifier,
        redirect_uri: c.client.redirectUris[0] ?? "",
      },
      basic(c.client.clientId, c.secret ?? ""),
    );
    expect(result.ok).toBe(true);
  });

  it("takes a secret in the form", async () => {
    const c = await confidential("client_secret_post");
    const result = await exchange({
      grant_type: "authorization_code",
      client_id: c.client.clientId,
      client_secret: c.secret ?? "",
      code: c.code,
      code_verifier: c.verifier,
      redirect_uri: c.client.redirectUris[0] ?? "",
    });
    expect(result.ok).toBe(true);
  });

  it("answers 401 invalid_client for a wrong, missing or unknown secret", async () => {
    const c = await confidential("client_secret_basic");
    const wrong = await exchange(
      {
        grant_type: "authorization_code",
        code: c.code,
        code_verifier: c.verifier,
      },
      basic(c.client.clientId, "nope"),
    );
    expect(wrong).toMatchObject({
      ok: false,
      status: 401,
      basicChallenge: true,
      body: { error: "invalid_client" },
    });
    const missing = await exchange({
      grant_type: "authorization_code",
      client_id: c.client.clientId,
      code: c.code,
      code_verifier: c.verifier,
    });
    expect(missing).toMatchObject({
      ok: false,
      status: 401,
      body: { error: "invalid_client" },
    });
    expect(missing).not.toHaveProperty("basicChallenge");
    const anonymous: Record<string, string>[] = [
      { grant_type: "authorization_code" },
      { grant_type: "authorization_code", client_id: "c1.made.up" },
    ];
    for (const fields of anonymous)
      expect(await exchange(fields)).toMatchObject({ status: 401 });
    expect(
      await exchange({ grant_type: "authorization_code" }, "Basic !!!"),
    ).toMatchObject({ status: 401 });
  });

  it("refuses two different client IDs", async () => {
    const c = await confidential("client_secret_basic");
    const result = await exchange(
      { grant_type: "authorization_code", client_id: claude.clientId },
      basic(c.client.clientId, c.secret ?? ""),
    );
    expect(errorOf(result)).toBe("invalid_request");
  });

  it("doesn't spend a code when client authentication fails", async () => {
    const c = await confidential("client_secret_basic");
    const fields = {
      grant_type: "authorization_code",
      code: c.code,
      code_verifier: c.verifier,
      redirect_uri: c.client.redirectUris[0] ?? "",
    };
    await exchange(fields, basic(c.client.clientId, "nope"));
    expect(
      (await exchange(fields, basic(c.client.clientId, c.secret ?? ""))).ok,
    ).toBe(true);
  });
});

describe("refresh_token", () => {
  it("rotates both tokens and retires the old pair", async () => {
    const first = await connect();
    const [before] = await fx.store.listGrants("acct");
    vi.advanceTimersByTime(60_000);
    const result = await exchange({
      grant_type: "refresh_token",
      client_id: claude.clientId,
      refresh_token: first.refresh_token,
    });
    if (!result.ok) throw new Error(result.body.error);
    const next = result.body;
    expect(next.access_token).not.toBe(first.access_token);
    expect(next.refresh_token).not.toBe(first.refresh_token);
    expect(
      (await checkAccessToken(fx.ctx(), `Bearer ${first.access_token}`)).ok,
    ).toBe(false);
    expect(
      (await checkAccessToken(fx.ctx(), `Bearer ${next.access_token}`)).ok,
    ).toBe(true);
    expect(
      errorOf(
        await exchange({
          grant_type: "refresh_token",
          client_id: claude.clientId,
          refresh_token: first.refresh_token,
        }),
      ),
    ).toBe("invalid_grant");
    const [after] = await fx.store.listGrants("acct");
    expect(after?.id).toBe(before?.id);
    expect(after?.refreshedAt).toBe(Date.now());
    expect(after?.createdAt).toBe(before?.createdAt);
  });

  it("ends the connection when another client presents its token", async () => {
    const first = await connect();
    const other = fx.client({
      redirect_uris: [CLAUDE_CALLBACK],
      token_endpoint_auth_method: "none",
    }).client;
    expect(
      errorOf(
        await exchange({
          grant_type: "refresh_token",
          client_id: other.clientId,
          refresh_token: first.refresh_token,
        }),
      ),
    ).toBe("invalid_grant");
    expect(await fx.store.listGrants("acct")).toEqual([]);
    expect(
      (await checkAccessToken(fx.ctx(), `Bearer ${first.access_token}`)).ok,
    ).toBe(false);
  });

  it("stops working after Disconnect or Delete my data", async () => {
    const one = await connect();
    const [grant] = await fx.store.listGrants("acct");
    if (grant) await fx.store.deleteGrant(grant);
    expect(
      errorOf(
        await exchange({
          grant_type: "refresh_token",
          client_id: claude.clientId,
          refresh_token: one.refresh_token,
        }),
      ),
    ).toBe("invalid_grant");
    const two = await connect();
    await fx.store.deleteAccountData("acct");
    expect(
      errorOf(
        await exchange({
          grant_type: "refresh_token",
          client_id: claude.clientId,
          refresh_token: two.refresh_token,
        }),
      ),
    ).toBe("invalid_grant");
  });
});

describe("checkAccessToken", () => {
  it("tells a missing token from a bad one", async () => {
    expect(await checkAccessToken(fx.ctx(), null)).toEqual({
      ok: false,
      tokenSent: false,
    });
    expect(await checkAccessToken(fx.ctx(), "Basic abc")).toEqual({
      ok: false,
      tokenSent: false,
    });
    expect(await checkAccessToken(fx.ctx(), "Bearer ferry_at_nope")).toEqual({
      ok: false,
      tokenSent: true,
    });
    expect(await checkAccessToken(fx.ctx(), "Bearer")).toEqual({
      ok: false,
      tokenSent: true,
    });
  });

  it("expires access tokens after an hour", async () => {
    const { access_token } = await connect();
    vi.advanceTimersByTime(MCP_ACCESS_TTL_S * 1000 - 1000);
    expect(
      (await checkAccessToken(fx.ctx(), `Bearer ${access_token}`)).ok,
    ).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(
      (await checkAccessToken(fx.ctx(), `Bearer ${access_token}`)).ok,
    ).toBe(false);
  });

  it("refuses a token for another resource", async () => {
    const { access_token } = await connect();
    expect(
      (
        await checkAccessToken(
          { ...fx.ctx(), resource: "https://other.example/mcp" },
          `Bearer ${access_token}`,
        )
      ).ok,
    ).toBe(false);
  });
});

describe("Disconnect racing a refresh", () => {
  /** A context whose store runs `meanwhile` right after one call, as a race would. */
  function racing(
    method: "getGrant" | "replaceGrant",
    meanwhile: () => Promise<void>,
  ) {
    const store = { ...fx.store };
    let fired = false;
    const original = fx.store[method] as (...args: never[]) => Promise<unknown>;
    (store as Record<string, unknown>)[method] = async (...args: never[]) => {
      const result = await original(...args);
      if (!fired) {
        fired = true;
        await meanwhile();
      }
      return result;
    };
    return { ...fx.ctx(), store };
  }
  const disconnectAll = async () => {
    for (const g of await fx.store.listGrants("acct"))
      await fx.store.deleteGrant(g);
  };
  const refreshWith = (ctx: ReturnType<typeof fx.ctx>, token: string) =>
    tokenRequest(
      ctx,
      new URLSearchParams({
        grant_type: "refresh_token",
        client_id: claude.clientId,
        refresh_token: token,
      }),
      null,
    );

  it("stays disconnected when Disconnect lands before the refresh writes", async () => {
    const first = await connect();
    const result = await refreshWith(
      racing("getGrant", disconnectAll),
      first.refresh_token,
    );
    expect(errorOf(result)).toBe("invalid_grant");
    expect(await fx.store.listGrants("acct")).toEqual([]);
  });

  it("refuses the new token when Disconnect lands after the refresh writes", async () => {
    const first = await connect();
    const result = await refreshWith(
      racing("replaceGrant", disconnectAll),
      first.refresh_token,
    );
    // The pair may go out, but the connection is gone, so neither works.
    if (result.ok) {
      expect(
        (await checkAccessToken(fx.ctx(), `Bearer ${result.body.access_token}`))
          .ok,
      ).toBe(false);
      expect(
        errorOf(await refreshWith(fx.ctx(), result.body.refresh_token)),
      ).toBe("invalid_grant");
    }
    expect(await fx.store.listGrants("acct")).toEqual([]);
  });

  it("refuses an access token its connection no longer holds", async () => {
    const { access_token } = await connect();
    const [grant] = await fx.store.listGrants("acct");
    if (!grant) throw new Error("no grant");
    // The grant moved on, but the old token's own key is still there.
    await fx.store.putGrant({ ...grant, accessHash: "something-else" });
    expect(
      (await checkAccessToken(fx.ctx(), `Bearer ${access_token}`)).ok,
    ).toBe(false);
  });
});

describe("a spent token or code coming back", () => {
  const refreshWith = (token: string) =>
    exchange({
      grant_type: "refresh_token",
      client_id: claude.clientId,
      refresh_token: token,
    });

  it("ends the connection when a rotated refresh token returns later", async () => {
    const first = await connect();
    const second = await refreshWith(first.refresh_token);
    if (!second.ok) throw new Error(second.body.error);
    vi.advanceTimersByTime(31_000);
    // Whoever holds the old token, the owner's app or a thief, the pair ends.
    expect(errorOf(await refreshWith(first.refresh_token))).toBe(
      "invalid_grant",
    );
    expect(await fx.store.listGrants("acct")).toEqual([]);
    expect(
      (await checkAccessToken(fx.ctx(), `Bearer ${second.body.access_token}`))
        .ok,
    ).toBe(false);
    expect(errorOf(await refreshWith(second.body.refresh_token))).toBe(
      "invalid_grant",
    );
  });

  it("takes a quick second refresh for the app's own retry, not a theft", async () => {
    const first = await connect();
    const second = await refreshWith(first.refresh_token);
    if (!second.ok) throw new Error(second.body.error);
    vi.advanceTimersByTime(5_000);
    expect(errorOf(await refreshWith(first.refresh_token))).toBe(
      "invalid_grant",
    );
    expect((await refreshWith(second.body.refresh_token)).ok).toBe(true);
  });

  it("ends the connection a code made when the code is used again", async () => {
    const { code, verifier } = await approve();
    const fields = {
      grant_type: "authorization_code",
      client_id: claude.clientId,
      code,
      code_verifier: verifier,
      redirect_uri: CLAUDE_CALLBACK,
    };
    const first = await exchange(fields);
    if (!first.ok) throw new Error(first.body.error);
    expect(errorOf(await exchange(fields))).toBe("invalid_grant");
    expect(
      (await checkAccessToken(fx.ctx(), `Bearer ${first.body.access_token}`))
        .ok,
    ).toBe(false);
    expect(await fx.store.listGrants("acct")).toEqual([]);
  });
});
