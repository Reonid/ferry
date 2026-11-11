import { baseUrl } from "@/lib/env";
import { discovery, preflight } from "@/lib/oauth/http";
import { authorizationServerMetadata } from "@/lib/oauth/metadata";

/** RFC 8414: Ferry is the authorization server for its own MCP endpoint. */
export function GET(): Response {
  return discovery(authorizationServerMetadata(baseUrl()));
}

export const OPTIONS = preflight;
