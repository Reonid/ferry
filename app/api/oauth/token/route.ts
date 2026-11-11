import { json, oauthContext, preflight, readBody } from "@/lib/oauth/http";
import { tokenRequest } from "@/lib/oauth/tokens";

/**
 * The token endpoint: codes and refresh tokens in, a rotating Bearer pair
 * out. Form bodies, as RFC 6749 says, and JSON for clients that send it.
 */

const MAX_BODY = 16 * 1024;

function invalidRequest(description: string): Response {
  return json(
    { error: "invalid_request", error_description: description },
    400,
  );
}

function parseForm(body: string, contentType: string): URLSearchParams | null {
  if (!/^application\/json\b/i.test(contentType))
    return new URLSearchParams(body);
  try {
    const data: unknown = JSON.parse(body);
    if (typeof data !== "object" || data === null || Array.isArray(data))
      return null;
    const form = new URLSearchParams();
    for (const [name, value] of Object.entries(data))
      if (typeof value === "string") form.append(name, value);
    return form;
  } catch {
    return null;
  }
}

export async function POST(request: Request): Promise<Response> {
  const body = await readBody(request, MAX_BODY);
  if (body === null) return invalidRequest("The request is too large.");
  const form = parseForm(body, request.headers.get("content-type") ?? "");
  if (form === null) return invalidRequest("The body can't be read.");
  const result = await tokenRequest(
    oauthContext(),
    form,
    request.headers.get("authorization"),
  );
  if (result.ok) return json(result.body);
  return json(
    result.body,
    result.status,
    result.basicChallenge ? { "WWW-Authenticate": 'Basic realm="Ferry"' } : {},
  );
}

export const OPTIONS = preflight;
