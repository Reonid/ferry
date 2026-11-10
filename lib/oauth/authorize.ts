import { readClient, redirectUriAllowed, type OAuthClient } from "./clients";
import { MCP_SCOPE, sameResource } from "./metadata";

/** A checked request to connect an app, as the consent screen shows it. */
export interface AuthorizationRequest {
  client: OAuthClient;
  redirectUri: string;
  /** Whether the app named its redirect URI, so its token request must too. */
  redirectUriSent: boolean;
  state: string | null;
  codeChallenge: string;
  scope: string;
}

export type AuthorizationCheck =
  | { ok: true; request: AuthorizationRequest }
  /** The app or its redirect URI is unknown, so the error stays on Ferry's page. */
  | { ok: false; redirect: null; message: string }
  /**
   * A known app's bad request. The consent screen only shows `message`.
   * Only an answer the owner sent goes back to the app, at `redirect`.
   */
  | { ok: false; redirect: string; message: string };

const MAX_STATE = 2048;
/** BASE64URL(SHA-256(verifier)) is always 43 characters. */
const S256_CHALLENGE = /^[A-Za-z0-9_-]{43}$/;

/** Appends OAuth response parameters, keeping any query the redirect URI already has. */
export function authorizationRedirect(
  redirectUri: string,
  params: Record<string, string | null>,
): string {
  const url = new URL(redirectUri);
  for (const [name, value] of Object.entries(params))
    if (value !== null) url.searchParams.set(name, value);
  return url.toString();
}

/** A parameter's one value: null when it's absent, undefined when it's repeated. */
function single(
  params: URLSearchParams,
  name: string,
): string | null | undefined {
  const all = params.getAll(name);
  if (all.length > 1) return undefined;
  return all[0] ?? null;
}

const onPage = (message: string): AuthorizationCheck => ({
  ok: false,
  redirect: null,
  message,
});

export function checkAuthorizationRequest(
  params: URLSearchParams,
  ctx: { key: Buffer; issuer: string; resource: string },
): AuthorizationCheck {
  const clientId = single(params, "client_id");
  const client = clientId ? readClient(clientId, ctx.key) : null;
  if (!client)
    return onPage(
      "Ferry doesn't recognize the app that sent you here. Start again from that app.",
    );

  const asked = single(params, "redirect_uri");
  const only = client.redirectUris.length === 1 ? client.redirectUris[0] : null;
  const redirectUri = asked === null ? only : asked;
  if (
    redirectUri === undefined ||
    redirectUri === null ||
    !redirectUriAllowed(client, redirectUri)
  )
    return onPage(
      "This link would send you somewhere the app didn't register, so Ferry stopped. Start again from the app.",
    );

  const rawState = single(params, "state");
  const state =
    typeof rawState === "string" && rawState.length <= MAX_STATE
      ? rawState
      : null;
  const fail = (error: string, description: string): AuthorizationCheck => ({
    ok: false,
    redirect: authorizationRedirect(redirectUri, {
      error,
      error_description: description,
      state,
      iss: ctx.issuer,
    }),
    message: `The app asked in a way Ferry can't accept (${description.replace(/\.$/, "")}). Start again from the app.`,
  });

  if (rawState === undefined)
    return fail("invalid_request", "Send state once.");
  if (typeof rawState === "string" && state === null)
    return fail("invalid_request", "state is too long.");
  for (const name of [
    "response_type",
    "code_challenge",
    "code_challenge_method",
    "scope",
  ])
    if (single(params, name) === undefined)
      return fail("invalid_request", `Send ${name} once.`);

  if (single(params, "response_type") !== "code")
    return fail("unsupported_response_type", "Ferry supports only code.");
  if (single(params, "code_challenge_method") !== "S256")
    return fail("invalid_request", "Use PKCE with S256.");
  const codeChallenge = single(params, "code_challenge");
  if (!codeChallenge || !S256_CHALLENGE.test(codeChallenge))
    return fail("invalid_request", "code_challenge isn't an S256 challenge.");
  if (!params.getAll("resource").every((r) => sameResource(r, ctx.resource)))
    return fail("invalid_target", `Ferry's MCP server is ${ctx.resource}.`);

  // Unknown scopes are dropped: reading Ferry is the only thing to grant.
  return {
    ok: true,
    request: {
      client,
      redirectUri,
      redirectUriSent: asked !== null,
      state,
      codeChallenge,
      scope: MCP_SCOPE,
    },
  };
}
