import type { TokenSet } from "@/lib/types";
import { TOKEN_REQUEST_TIMEOUT_MS } from "@/lib/constants";

const AUTHORIZE_URL = "https://auth.buffer.com/auth";
const TOKEN_URL = "https://auth.buffer.com/token";

/** Read-only on purpose: Ferry never writes to Buffer. */
export const BUFFER_SCOPE = "account:read posts:read offline_access";

export const OAUTH_STATE_COOKIE = "ferry_oauth_state";
export const OAUTH_VERIFIER_COOKIE = "ferry_oauth_verifier";

/** A failed token request. `code` is the provider's `error` value or "bad_response". Messages never carry tokens. */
export class OAuthError extends Error {
  code: string;
  constructor(code: string) {
    super(`Buffer token request failed: ${code}`);
    this.name = "OAuthError";
    this.code = code;
  }
}

export function bufferAuthorizeUrl(args: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("client_id", args.clientId);
  url.searchParams.set("redirect_uri", args.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", BUFFER_SCOPE);
  url.searchParams.set("state", args.state);
  url.searchParams.set("code_challenge", args.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("prompt", "consent");
  return url.toString();
}

async function tokenRequest(
  form: Record<string, string>,
  now: number,
  fetchImpl: typeof fetch | undefined,
): Promise<TokenSet> {
  const doFetch = fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await doFetch(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(form),
      signal: AbortSignal.timeout(TOKEN_REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new OAuthError("bad_response");
  }
  const payload = (await response.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (!response.ok || !payload || typeof payload !== "object") {
    const code =
      payload && typeof payload.error === "string" && payload.error
        ? payload.error
        : "bad_response";
    throw new OAuthError(code);
  }
  const { access_token, refresh_token, expires_in } = payload;
  if (
    typeof access_token !== "string" ||
    access_token === "" ||
    typeof refresh_token !== "string" ||
    refresh_token === "" ||
    typeof expires_in !== "number" ||
    !Number.isFinite(expires_in) ||
    expires_in <= 0
  ) {
    throw new OAuthError("bad_response");
  }
  return {
    accessToken: access_token,
    refreshToken: refresh_token,
    expiresAt: now + expires_in * 1000,
  };
}

export function exchangeBufferCode(args: {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
  codeVerifier: string;
  now: number;
  fetchImpl?: typeof fetch;
}): Promise<TokenSet> {
  return tokenRequest(
    {
      client_id: args.clientId,
      client_secret: args.clientSecret,
      grant_type: "authorization_code",
      code: args.code,
      redirect_uri: args.redirectUri,
      code_verifier: args.codeVerifier,
    },
    args.now,
    args.fetchImpl,
  );
}

export function refreshBufferToken(args: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  now: number;
  fetchImpl?: typeof fetch;
}): Promise<TokenSet> {
  return tokenRequest(
    {
      client_id: args.clientId,
      client_secret: args.clientSecret,
      grant_type: "refresh_token",
      refresh_token: args.refreshToken,
    },
    args.now,
    args.fetchImpl,
  );
}
