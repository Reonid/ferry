import { baseUrl } from "@/lib/env";
import { discovery, preflight } from "@/lib/oauth/http";
import { protectedResourceMetadata } from "@/lib/oauth/metadata";

/** RFC 9728 for /mcp: where Ferry's 401 points (resource_metadata). */
export function GET(): Response {
  return discovery(protectedResourceMetadata(baseUrl()));
}

export const OPTIONS = preflight;
