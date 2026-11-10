import { createHmac, timingSafeEqual } from "node:crypto";
import { deriveKey } from "../crypto";

/**
 * Dynamic client registration (RFC 7591) that writes nothing down. A
 * client's ID is its registration, signed: `c1.<payload>.<signature>`,
 * where the payload is the app's name, redirect URIs, token endpoint auth
 * method and registration time. Registration is open to anyone, so keeping
 * records would let anyone fill the database. A secret, for clients that
 * want one, is a second signature of the ID.
 */

export type ClientAuthMethod =
  "none" | "client_secret_post" | "client_secret_basic";

export interface OAuthClient {
  clientId: string;
  /** Chosen by the app, so never proof of who it is. */
  name: string | null;
  redirectUris: string[];
  authMethod: ClientAuthMethod;
  /** Epoch seconds, as RFC 7591 counts them. */
  issuedAt: number;
}

export type RegistrationResult =
  | {
      ok: true;
      client: OAuthClient;
      clientSecret: string | null;
      /** The RFC 7591 response body. */
      response: Record<string, unknown>;
    }
  | {
      ok: false;
      error: "invalid_redirect_uri" | "invalid_client_metadata";
      description: string;
    };

const PREFIX = "c1";
const MAX_REDIRECT_URIS = 5;
const MAX_REDIRECT_URI = 512;
const MAX_NAME = 80;
const MAX_CLIENT_ID = 4096;
const AUTH_METHODS: readonly ClientAuthMethod[] = [
  "none",
  "client_secret_post",
  "client_secret_basic",
];
const GRANT_TYPES = ["authorization_code", "refresh_token"];
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

interface Payload {
  n: string | null;
  r: string[];
  m: ClientAuthMethod;
  t: number;
}

function sign(data: string, key: Buffer, purpose: string): string {
  return createHmac("sha256", deriveKey(key, purpose))
    .update(data)
    .digest("base64url");
}

function sameText(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** https anywhere, or http on this machine only; never a fragment or a password. */
export function validRedirectUri(raw: string): boolean {
  if (raw.length > MAX_REDIRECT_URI || raw.includes("#")) return false;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.username !== "" || url.password !== "") return false;
  if (url.protocol === "https:") return true;
  return url.protocol === "http:" && LOOPBACK.has(url.hostname);
}

/**
 * Whether `uri` is one the client registered. Loopback URIs match with any
 * port, as RFC 8252 asks: a native app picks a free port each time.
 */
export function redirectUriAllowed(client: OAuthClient, uri: string): boolean {
  if (!validRedirectUri(uri)) return false;
  if (client.redirectUris.includes(uri)) return true;
  const asked = new URL(uri);
  if (asked.protocol !== "http:") return false;
  return client.redirectUris.some((registered) => {
    const r = new URL(registered);
    return (
      r.protocol === "http:" &&
      r.hostname === asked.hostname &&
      r.pathname === asked.pathname &&
      r.search === asked.search
    );
  });
}

/** Printable, one line, no direction overrides, at most 80 characters. */
function cleanName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value
    .replace(/[\t\n\r]/g, " ")
    .replace(/[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text === "" ? null : Array.from(text).slice(0, MAX_NAME).join("");
}

function encodeId(payload: Payload, key: Buffer): string {
  const body = `${PREFIX}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}`;
  return `${body}.${sign(body, key, "mcp client id")}`;
}

/** The client a signed ID stands for, or null when it's forged, damaged or another key's. */
export function readClient(clientId: string, key: Buffer): OAuthClient | null {
  if (clientId.length > MAX_CLIENT_ID) return null;
  const parts = clientId.split(".");
  const [prefix, payload, signature] = parts;
  if (
    parts.length !== 3 ||
    prefix !== PREFIX ||
    !payload ||
    !signature ||
    !sameText(signature, sign(`${prefix}.${payload}`, key, "mcp client id"))
  )
    return null;
  let data: Payload;
  try {
    data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (
    !Array.isArray(data.r) ||
    !AUTH_METHODS.includes(data.m) ||
    typeof data.t !== "number"
  )
    return null;
  return {
    clientId,
    name: typeof data.n === "string" ? data.n : null,
    redirectUris: data.r.filter((u): u is string => typeof u === "string"),
    authMethod: data.m,
    issuedAt: data.t,
  };
}

/** A secret-method client's secret: derived from its ID, so it needs no storage. */
function secretFor(clientId: string, key: Buffer): string {
  return sign(clientId, key, "mcp client secret");
}

export function checkClientSecret(
  clientId: string,
  secret: string,
  key: Buffer,
): boolean {
  return secret !== "" && sameText(secret, secretFor(clientId, key));
}

const invalid = (
  error: "invalid_redirect_uri" | "invalid_client_metadata",
  description: string,
): RegistrationResult => ({ ok: false, error, description });

export function registerClient(
  metadata: unknown,
  key: Buffer,
  now: number,
): RegistrationResult {
  if (
    typeof metadata !== "object" ||
    metadata === null ||
    Array.isArray(metadata)
  )
    return invalid(
      "invalid_client_metadata",
      "Send the client metadata as a JSON object.",
    );
  const m = metadata as Record<string, unknown>;

  const uris = m.redirect_uris;
  if (
    !Array.isArray(uris) ||
    uris.length === 0 ||
    uris.length > MAX_REDIRECT_URIS ||
    !uris.every((u) => typeof u === "string" && validRedirectUri(u))
  )
    return invalid(
      "invalid_redirect_uri",
      "Give 1 to 5 redirect URIs: https, or http on localhost, with no fragment.",
    );

  const grants = m.grant_types;
  if (
    grants !== undefined &&
    (!Array.isArray(grants) ||
      !grants.every((g) => typeof g === "string" && GRANT_TYPES.includes(g)))
  )
    return invalid(
      "invalid_client_metadata",
      "Ferry supports the authorization_code and refresh_token grants.",
    );

  const responses = m.response_types;
  if (
    responses !== undefined &&
    (!Array.isArray(responses) || !responses.every((r) => r === "code"))
  )
    return invalid(
      "invalid_client_metadata",
      "Ferry supports only the code response type.",
    );

  // RFC 7591 makes client_secret_basic the default.
  const method = m.token_endpoint_auth_method ?? "client_secret_basic";
  if (!AUTH_METHODS.includes(method as ClientAuthMethod))
    return invalid(
      "invalid_client_metadata",
      "Use none, client_secret_post or client_secret_basic.",
    );

  const issuedAt = Math.floor(now / 1000);
  const payload: Payload = {
    n: cleanName(m.client_name),
    r: uris as string[],
    m: method as ClientAuthMethod,
    t: issuedAt,
  };
  const clientId = encodeId(payload, key);
  // Long URIs grow once encoded; an ID readClient would refuse helps no one.
  if (clientId.length > MAX_CLIENT_ID)
    return invalid(
      "invalid_client_metadata",
      "The registration is too long. Use fewer or shorter redirect URIs.",
    );
  const client: OAuthClient = {
    clientId,
    name: payload.n,
    redirectUris: payload.r,
    authMethod: payload.m,
    issuedAt,
  };
  const clientSecret =
    client.authMethod === "none" ? null : secretFor(clientId, key);
  return {
    ok: true,
    client,
    clientSecret,
    response: {
      client_id: clientId,
      client_id_issued_at: issuedAt,
      ...(client.name !== null ? { client_name: client.name } : {}),
      redirect_uris: client.redirectUris,
      grant_types: GRANT_TYPES,
      response_types: ["code"],
      token_endpoint_auth_method: client.authMethod,
      ...(clientSecret !== null
        ? { client_secret: clientSecret, client_secret_expires_at: 0 }
        : {}),
    },
  };
}
