/**
 * Where Ferry's MCP server and its OAuth endpoints live, and the two
 * discovery documents that tell AI apps so: RFC 9728 for the MCP endpoint
 * and RFC 8414 for the authorization server, which is Ferry itself.
 */

/** The one scope: reading this account's Ferry data. */
export const MCP_SCOPE = "ferry:read";

export interface OAuthUrls {
  issuer: string;
  /** The MCP endpoint, and the resource every token is for. */
  resource: string;
  resourceMetadata: string;
  authorize: string;
  token: string;
  register: string;
}

/** `base` is baseUrl(): an origin with no trailing slash. */
export function oauthUrls(base: string): OAuthUrls {
  return {
    issuer: base,
    resource: `${base}/mcp`,
    resourceMetadata: `${base}/.well-known/oauth-protected-resource/mcp`,
    authorize: `${base}/oauth/authorize`,
    token: `${base}/api/oauth/token`,
    register: `${base}/api/oauth/register`,
  };
}

export function protectedResourceMetadata(base: string) {
  const urls = oauthUrls(base);
  return {
    resource: urls.resource,
    authorization_servers: [urls.issuer],
    scopes_supported: [MCP_SCOPE],
    bearer_methods_supported: ["header"],
    resource_name: "Ferry",
    resource_documentation: `${base}/privacy`,
  };
}

export function authorizationServerMetadata(base: string) {
  const urls = oauthUrls(base);
  return {
    issuer: urls.issuer,
    authorization_endpoint: urls.authorize,
    token_endpoint: urls.token,
    registration_endpoint: urls.register,
    scopes_supported: [MCP_SCOPE],
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: [
      "none",
      "client_secret_post",
      "client_secret_basic",
    ],
    code_challenge_methods_supported: ["S256"],
    // Every authorization response carries iss (RFC 9207).
    authorization_response_iss_parameter_supported: true,
    service_documentation: `${base}/privacy`,
  };
}

/**
 * Whether an RFC 8707 resource value names Ferry's MCP endpoint. Scheme and
 * host compare without case, and a trailing slash doesn't count.
 */
export function sameResource(value: string, resource: string): boolean {
  let a: URL;
  let b: URL;
  try {
    a = new URL(value);
    b = new URL(resource);
  } catch {
    return false;
  }
  if (value.includes("#") || a.search !== "") return false;
  const path = (p: string) => p.replace(/\/+$/, "") || "/";
  return a.origin === b.origin && path(a.pathname) === path(b.pathname);
}
