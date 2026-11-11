import { loadKey } from "@/lib/crypto";
import { env } from "@/lib/env";
import { registerClient } from "@/lib/oauth/clients";
import { json, preflight, readBody } from "@/lib/oauth/http";

/** RFC 7591 dynamic client registration. It stores nothing: see lib/oauth/clients. */

const MAX_BODY = 16 * 1024;

export async function POST(request: Request): Promise<Response> {
  const body = await readBody(request, MAX_BODY);
  if (body === null)
    return json(
      {
        error: "invalid_client_metadata",
        error_description: "The registration is too large.",
      },
      413,
    );
  let metadata: unknown;
  try {
    metadata = JSON.parse(body);
  } catch {
    return json(
      {
        error: "invalid_client_metadata",
        error_description: "Send the client metadata as JSON.",
      },
      400,
    );
  }
  const result = registerClient(
    metadata,
    loadKey(env("ENCRYPTION_KEY")),
    Date.now(),
  );
  return result.ok
    ? json(result.response, 201)
    : json({ error: result.error, error_description: result.description }, 400);
}

export const OPTIONS = preflight;
