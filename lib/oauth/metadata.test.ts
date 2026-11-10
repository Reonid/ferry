import { describe, expect, it } from "vitest";
import {
  authorizationServerMetadata,
  oauthUrls,
  protectedResourceMetadata,
  sameResource,
} from "./metadata";

const BASE = "https://ferry.example";

describe("discovery documents", () => {
  it("names the MCP endpoint and Ferry as its authorization server", () => {
    expect(protectedResourceMetadata(BASE)).toMatchObject({
      resource: `${BASE}/mcp`,
      authorization_servers: [BASE],
      scopes_supported: ["ferry:read"],
      bearer_methods_supported: ["header"],
    });
    expect(oauthUrls(BASE).resourceMetadata).toBe(
      `${BASE}/.well-known/oauth-protected-resource/mcp`,
    );
  });

  it("advertises what Claude and ChatGPT check for", () => {
    const meta = authorizationServerMetadata(BASE);
    expect(meta).toMatchObject({
      issuer: BASE,
      authorization_endpoint: `${BASE}/oauth/authorize`,
      token_endpoint: `${BASE}/api/oauth/token`,
      registration_endpoint: `${BASE}/api/oauth/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      authorization_response_iss_parameter_supported: true,
    });
    expect(meta.token_endpoint_auth_methods_supported).toContain("none");
    // No CIMD yet, so both apps register with DCR.
    expect(meta).not.toHaveProperty("client_id_metadata_document_supported");
  });
});

describe("sameResource", () => {
  const resource = `${BASE}/mcp`;

  it("matches the MCP URL, ignoring case of scheme and host and a trailing slash", () => {
    for (const value of [
      resource,
      `${resource}/`,
      "HTTPS://FERRY.EXAMPLE/mcp",
      "https://ferry.example:443/mcp",
    ])
      expect(sameResource(value, resource), value).toBe(true);
  });

  it("refuses anything else", () => {
    for (const value of [
      BASE,
      `${BASE}/MCP`,
      `${resource}/x`,
      `${resource}?a=1`,
      `${resource}#x`,
      "http://ferry.example/mcp",
      "https://ferry.example.evil/mcp",
      "not a url",
    ])
      expect(sameResource(value, resource), value).toBe(false);
  });
});
