import { NextResponse, type NextRequest } from "next/server";
import { decideConsent } from "@/lib/oauth/consent";
import { oauthContext } from "@/lib/oauth/http";
import { getSession } from "@/lib/session";

/**
 * Allow or Cancel on the consent screen. The form posts to this URL with
 * the authorization request in the query, and the answer goes back to the
 * app with a 303.
 */
export async function POST(request: NextRequest): Promise<Response> {
  const session = await getSession();
  const form = await request.formData().catch(() => null);
  const result = await decideConsent({
    ctx: oauthContext(),
    origin: request.headers.get("origin"),
    accountId: session.accountId ?? null,
    params: request.nextUrl.searchParams,
    allow: form?.get("decision") === "allow",
  });
  if (result.status !== 303)
    return new Response(result.message, {
      status: result.status,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  const response = NextResponse.redirect(result.location, 303);
  // The code is in the URL: send no Referer with it and cache nothing.
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("Cache-Control", "no-store");
  return response;
}
