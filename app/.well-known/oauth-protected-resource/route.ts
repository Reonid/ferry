import { baseUrl } from "@/lib/env";
import { discovery, preflight } from "@/lib/oauth/http";
import { protectedResourceMetadata } from "@/lib/oauth/metadata";

/** RFC 9728 at the root path, for apps that look here before the /mcp suffix. */
export function GET(): Response {
  return discovery(protectedResourceMetadata(baseUrl()));
}

export const OPTIONS = preflight;
