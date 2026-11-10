import { loadKey } from "../crypto";
import { baseUrl, env } from "../env";
import { getStore } from "../store";
import { MCP_SCOPE, oauthUrls, type OAuthUrls } from "./metadata";
import type { OAuthContext } from "./tokens";

/**
 * What Ferry's MCP and OAuth route handlers share. None of these endpoints
 * reads a cookie, so any origin may call them: a stolen token is the only
 * way in, and CORS can't stop that.
 */
export const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Authorization, Content-Type, Accept, MCP-Protocol-Version, Mcp-Session-Id, Last-Event-ID",
  "Access-Control-Expose-Headers": "WWW-Authenticate, MCP-Protocol-Version",
  "Access-Control-Max-Age": "86400",
};

const NO_STORE = { "Cache-Control": "no-store", Pragma: "no-cache" };

export function preflight(): Response {
  return new Response(null, { status: 204, headers: CORS });
}

export function json(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return Response.json(body, {
    status,
    headers: { ...CORS, ...NO_STORE, ...headers },
  });
}

/** A discovery document: public, and fine to cache for a few minutes. */
export function discovery(body: unknown): Response {
  return Response.json(body, {
    headers: { ...CORS, "Cache-Control": "public, max-age=300" },
  });
}

/** The body as text, or null when it's larger than `limit` bytes. */
export async function readBody(
  request: Request,
  limit: number,
): Promise<string | null> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > limit) return null;
  const text = await request.text();
  return Buffer.byteLength(text) > limit ? null : text;
}

export function urls(): OAuthUrls {
  return oauthUrls(baseUrl());
}

export function oauthContext(): OAuthContext {
  const { issuer, resource } = urls();
  return {
    store: getStore(),
    key: loadKey(env("ENCRYPTION_KEY")),
    issuer,
    resource,
    now: Date.now(),
  };
}

/**
 * RFC 6750's 401, pointing at the resource metadata so an AI app can find
 * Ferry's sign-in (RFC 9728). invalid_token only when a token was sent.
 */
export function unauthorized(tokenSent: boolean): Response {
  const { resourceMetadata } = urls();
  const description = tokenSent
    ? "The access token is invalid, expired or revoked. Connect Ferry again."
    : "Connect Ferry first: sign in with Buffer when your app asks.";
  const challenge = [
    'realm="Ferry"',
    ...(tokenSent
      ? ['error="invalid_token"', `error_description="${description}"`]
      : []),
    `resource_metadata="${resourceMetadata}"`,
    `scope="${MCP_SCOPE}"`,
  ].join(", ");
  return json(
    {
      error: tokenSent ? "invalid_token" : "unauthorized",
      error_description: description,
    },
    401,
    { "WWW-Authenticate": `Bearer ${challenge}` },
  );
}
