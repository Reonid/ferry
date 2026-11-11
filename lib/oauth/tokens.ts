import { timingSafeEqual } from "node:crypto";
import {
  MCP_ACCESS_TTL_S,
  MCP_GRANTS_KEPT,
  REFRESH_REUSE_GRACE_MS,
} from "../constants";
import { hashSecret, newId, newSecret } from "../crypto";
import type { Store } from "../store/store";
import type { McpGrant, OAuthCode } from "../types";
import type { AuthorizationRequest } from "./authorize";
import { checkClientSecret, readClient, type OAuthClient } from "./clients";
import { sameResource } from "./metadata";

/**
 * Ferry's token endpoint and the check on every MCP request. Codes and
 * tokens are 256-bit random strings that Ferry files by their SHA-256,
 * so its database never holds one that works.
 */

export interface OAuthContext {
  store: Store;
  key: Buffer;
  issuer: string;
  resource: string;
  now: number;
}

// Prefixes say what a leaked string is, and that it's Ferry's.
const CODE_PREFIX = "ferry_ac_";
const ACCESS_PREFIX = "ferry_at_";
const REFRESH_PREFIX = "ferry_rt_";
/** RFC 7636: 43 to 128 unreserved characters. */
const VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;

export interface TokenResponse {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  scope: string;
}

export type TokenResult =
  | { ok: true; body: TokenResponse }
  | {
      ok: false;
      status: 400 | 401;
      body: { error: string; error_description: string };
      /** The client tried HTTP Basic, so the 401 says Basic again (RFC 6749 5.2). */
      basicChallenge?: boolean;
    };

const fail = (
  error: string,
  error_description: string,
  status: 400 | 401 = 400,
  basicChallenge = false,
): TokenResult => ({
  ok: false,
  status,
  body: { error, error_description },
  ...(basicChallenge ? { basicChallenge } : {}),
});

const sameText = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

function single(
  form: URLSearchParams,
  name: string,
): string | null | undefined {
  const all = form.getAll(name);
  if (all.length > 1) return undefined;
  return all[0] ?? null;
}

/** Saves a one-time code for an approved request and returns it. */
export async function issueCode(
  ctx: OAuthContext,
  accountId: string,
  request: AuthorizationRequest,
): Promise<string> {
  const code = CODE_PREFIX + newSecret();
  const record: OAuthCode = {
    accountId,
    clientId: request.client.clientId,
    clientName: request.client.name,
    redirectUri: request.redirectUri,
    redirectUriSent: request.redirectUriSent,
    codeChallenge: request.codeChallenge,
    scope: request.scope,
    resource: ctx.resource,
    createdAt: ctx.now,
  };
  await ctx.store.putOAuthCode(hashSecret(code), record);
  return code;
}

/** RFC 6749 2.3.1: the ID and secret are form-encoded before base64. */
function basicCredentials(
  header: string | null,
): { id: string; secret: string } | null | "malformed" {
  const match = /^Basic\s+([A-Za-z0-9+/]+={0,2})\s*$/i.exec(header ?? "");
  if (!match?.[1]) return null;
  const decoded = Buffer.from(match[1], "base64").toString("utf8");
  const colon = decoded.indexOf(":");
  if (colon < 0) return "malformed";
  const unform = (s: string) => decodeURIComponent(s.replace(/\+/g, " "));
  try {
    return {
      id: unform(decoded.slice(0, colon)),
      secret: unform(decoded.slice(colon + 1)),
    };
  } catch {
    return "malformed";
  }
}

function authenticate(
  ctx: OAuthContext,
  form: URLSearchParams,
  authorization: string | null,
): { ok: true; client: OAuthClient } | { ok: false; result: TokenResult } {
  const basic = basicCredentials(authorization);
  const usedBasic = basic !== null;
  const invalidClient = (description: string) => ({
    ok: false as const,
    result: fail("invalid_client", description, 401, usedBasic),
  });
  if (basic === "malformed")
    return invalidClient("The Basic credentials can't be read.");
  const formId = single(form, "client_id");
  const formSecret = single(form, "client_secret");
  if (formId === undefined || formSecret === undefined)
    return {
      ok: false,
      result: fail("invalid_request", "Send each parameter once."),
    };
  if (basic && formId !== null && formId !== basic.id)
    return {
      ok: false,
      result: fail("invalid_request", "Two different client IDs were sent."),
    };
  const id = basic?.id ?? formId;
  const client = id ? readClient(id, ctx.key) : null;
  if (!client) return invalidClient("Ferry doesn't know this client.");
  if (client.authMethod !== "none") {
    const secret = basic?.secret ?? formSecret ?? "";
    if (!checkClientSecret(client.clientId, secret, ctx.key))
      return invalidClient("The client secret is wrong.");
  }
  return { ok: true, client };
}

function tokenBody(access: string, refresh: string, scope: string) {
  return {
    ok: true as const,
    body: {
      access_token: access,
      token_type: "Bearer" as const,
      expires_in: MCP_ACCESS_TTL_S,
      refresh_token: refresh,
      scope,
    },
  };
}

/** A fresh pair for `grant`: the raw tokens, and the grant holding their hashes. */
function mintTokens(grant: Omit<McpGrant, "accessHash" | "refreshHash">) {
  const access = ACCESS_PREFIX + newSecret();
  const refresh = REFRESH_PREFIX + newSecret();
  const minted: McpGrant = {
    ...grant,
    accessHash: hashSecret(access),
    refreshHash: hashSecret(refresh),
  };
  return { access, refresh, grant: minted };
}

/** Files a minted pair under its hashes, once its grant is saved, and returns it. */
async function issueTokens(
  ctx: OAuthContext,
  minted: ReturnType<typeof mintTokens>,
): Promise<TokenResult> {
  const { grant } = minted;
  await ctx.store.putAccessToken(grant.accessHash, {
    grantId: grant.id,
    accountId: grant.accountId,
    scope: grant.scope,
    resource: grant.resource,
    expiresAt: ctx.now + MCP_ACCESS_TTL_S * 1000,
  });
  await ctx.store.putRefreshToken(grant.refreshHash, grant.id);
  return tokenBody(minted.access, minted.refresh, grant.scope);
}

async function exchangeCode(
  ctx: OAuthContext,
  client: OAuthClient,
  form: URLSearchParams,
): Promise<TokenResult> {
  const code = single(form, "code");
  const verifier = single(form, "code_verifier");
  const redirectUri = single(form, "redirect_uri");
  if (!code || !verifier || redirectUri === undefined)
    return fail("invalid_request", "Send code and code_verifier once each.");
  if (!VERIFIER.test(verifier))
    return fail("invalid_request", "code_verifier isn't a PKCE verifier.");

  const codeHash = hashSecret(code);
  const record = await ctx.store.takeOAuthCode(codeHash);
  const gone = fail(
    "invalid_grant",
    "This code has been used, has expired or isn't Ferry's.",
  );
  if (!record) {
    // A code used twice ends the connection it made (RFC 6749 4.1.2).
    await endConnection(ctx, await ctx.store.getSpentCode(codeHash));
    return gone;
  }
  if (record.clientId !== client.clientId) return gone;
  const redirectMatches = record.redirectUriSent
    ? redirectUri === record.redirectUri
    : redirectUri === null || redirectUri === record.redirectUri;
  if (!redirectMatches)
    return fail("invalid_grant", "redirect_uri doesn't match the request.");
  if (!sameText(hashSecret(verifier), record.codeChallenge))
    return fail("invalid_grant", "code_verifier doesn't match the challenge.");
  if (!(await ctx.store.getAccount(record.accountId))) return gone;

  const minted = mintTokens({
    id: newId(),
    accountId: record.accountId,
    clientId: client.clientId,
    clientName: record.clientName,
    redirectHost: new URL(record.redirectUri).hostname,
    scope: record.scope,
    resource: record.resource,
    createdAt: ctx.now,
    refreshedAt: ctx.now,
  });
  await ctx.store.putGrant(minted.grant);
  await ctx.store.markCodeSpent(codeHash, minted.grant.id);
  const result = await issueTokens(ctx, minted);
  // The newest connections stay; an 11th disconnects the oldest.
  const grants = await ctx.store.listGrants(record.accountId);
  for (const old of grants.slice(
    0,
    Math.max(0, grants.length - MCP_GRANTS_KEPT),
  ))
    await ctx.store.deleteGrant(old);
  return result;
}

async function refresh(
  ctx: OAuthContext,
  client: OAuthClient,
  form: URLSearchParams,
): Promise<TokenResult> {
  const token = single(form, "refresh_token");
  if (!token) return fail("invalid_request", "Send refresh_token once.");
  const gone = fail(
    "invalid_grant",
    "This refresh token has been used, has expired or was revoked.",
  );
  // Refresh tokens are single use: the new pair replaces this one.
  const hash = hashSecret(token);
  const grantId = await ctx.store.takeRefreshToken(hash);
  if (!grantId) {
    // A rotated-out token came back. Soon after, it's the app's own retry.
    // Later, two parties hold the connection and Ferry can't tell which is
    // the owner's app, so it ends it (RFC 9700 4.14.2).
    const spent = await ctx.store.getSpentRefresh(hash);
    if (spent && ctx.now - spent.at > REFRESH_REUSE_GRACE_MS)
      await endConnection(ctx, spent.grantId);
    return gone;
  }
  const grant = await ctx.store.getGrant(grantId);
  // A key a race left behind can name a grant that has moved on.
  if (!grant || grant.refreshHash !== hash) return gone;
  if (
    grant.clientId !== client.clientId ||
    !(await ctx.store.getAccount(grant.accountId))
  ) {
    // Another client holding this token means it leaked: end the connection.
    await ctx.store.deleteGrant(grant);
    return gone;
  }
  const minted = mintTokens({ ...grant, refreshedAt: ctx.now });
  // Written only over a connection that still exists, so a Disconnect that
  // lands mid-refresh stays done.
  if (!(await ctx.store.replaceGrant(minted.grant))) return gone;
  await ctx.store.markRefreshSpent(hash, { grantId: grant.id, at: ctx.now });
  await ctx.store.deleteAccessToken(grant.accessHash);
  return issueTokens(ctx, minted);
}

/** Deletes a connection and both of its current tokens, if it still exists. */
async function endConnection(
  ctx: OAuthContext,
  grantId: string | null,
): Promise<void> {
  const grant = grantId ? await ctx.store.getGrant(grantId) : null;
  if (grant) await ctx.store.deleteGrant(grant);
}

/** POST /api/oauth/token, after the body is parsed into a form. */
export async function tokenRequest(
  ctx: OAuthContext,
  form: URLSearchParams,
  authorization: string | null,
): Promise<TokenResult> {
  const auth = authenticate(ctx, form, authorization);
  if (!auth.ok) return auth.result;
  if (!form.getAll("resource").every((r) => sameResource(r, ctx.resource)))
    return fail("invalid_target", `Ferry's MCP server is ${ctx.resource}.`);
  const grantType = single(form, "grant_type");
  if (grantType === "authorization_code")
    return exchangeCode(ctx, auth.client, form);
  if (grantType === "refresh_token") return refresh(ctx, auth.client, form);
  return fail(
    "unsupported_grant_type",
    "Use authorization_code or refresh_token.",
  );
}

export type AccessCheck =
  | { ok: true; accountId: string; grantId: string; scope: string }
  /** `tokenSent` decides whether the 401 says invalid_token (RFC 6750 3.1). */
  | { ok: false; tokenSent: boolean };

/** Checks an MCP request's Authorization header. */
export async function checkAccessToken(
  ctx: Pick<OAuthContext, "store" | "resource" | "now">,
  authorization: string | null,
): Promise<AccessCheck> {
  const header = authorization ?? "";
  const match = /^Bearer\s+([\w.~+/-]+=*)\s*$/i.exec(header);
  if (!match?.[1]) return { ok: false, tokenSent: /^Bearer\b/i.test(header) };
  const hash = hashSecret(match[1]);
  const access = await ctx.store.getAccessToken(hash);
  if (
    !access ||
    access.expiresAt <= ctx.now ||
    !sameResource(access.resource, ctx.resource)
  )
    return { ok: false, tokenSent: true };
  // The connection must still hold this token. After a Disconnect or a
  // rotation, a token whose own key outlived the change stops all the same.
  const grant = await ctx.store.getGrant(access.grantId);
  if (
    !grant ||
    grant.accessHash !== hash ||
    grant.accountId !== access.accountId
  )
    return { ok: false, tokenSent: true };
  return {
    ok: true,
    accountId: access.accountId,
    grantId: access.grantId,
    scope: access.scope,
  };
}
