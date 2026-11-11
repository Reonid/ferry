import { ferryMcpServer } from "@/lib/mcp/tools";
import { handleMcpPost } from "@/lib/mcp/protocol";
import { baseUrl } from "@/lib/env";
import { allowsChanges } from "@/lib/oauth/metadata";
import {
  CORS,
  json,
  preflight,
  readBody,
  unauthorized,
  urls,
} from "@/lib/oauth/http";
import { checkAccessToken } from "@/lib/oauth/tokens";
import { getStore } from "@/lib/store";
import { productionDeps } from "@/lib/sync/production";

/**
 * Ferry's MCP endpoint (Streamable HTTP). Every method needs a token, so
 * the first request from an app that isn't connected yet gets the 401 that
 * starts its sign-in. No Origin check: no cookie is read here, so a page
 * in a browser has nothing to borrow.
 */

const MAX_BODY = 64 * 1024;

async function signedIn(request: Request) {
  const store = getStore();
  const now = Date.now();
  const check = await checkAccessToken(
    { store, resource: urls().resource, now },
    request.headers.get("authorization"),
  );
  if (!check.ok)
    return { ok: false as const, response: unauthorized(check.tokenSent) };
  // Deleting an account deletes its tokens; this covers a request mid-way.
  if (!(await store.getAccount(check.accountId)))
    return { ok: false as const, response: unauthorized(true) };
  return {
    ok: true as const,
    store,
    now,
    accountId: check.accountId,
    write: allowsChanges(check.scope),
  };
}

export async function POST(request: Request): Promise<Response> {
  const auth = await signedIn(request);
  if (!auth.ok) return auth.response;
  const body = await readBody(request, MAX_BODY);
  if (body === null)
    return json(
      {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32600, message: "The request is too large." },
      },
      413,
    );
  const base = baseUrl();
  const reply = await handleMcpPost(
    // The token's scope decides which tools this connection gets.
    ferryMcpServer(base, { write: auth.write }),
    body,
    // An empty header counts as none.
    request.headers.get("mcp-protocol-version") || null,
    {
      store: auth.store,
      accountId: auth.accountId,
      now: auth.now,
      baseUrl: base,
      syncDeps: productionDeps,
    },
  );
  if (reply.body === null)
    return new Response(null, { status: reply.status, headers: CORS });
  return json(reply.body, reply.status);
}

/** No server-to-client stream: everything Ferry says answers a POST. */
async function notAllowed(request: Request): Promise<Response> {
  const auth = await signedIn(request);
  if (!auth.ok) return auth.response;
  return json(
    {
      jsonrpc: "2.0",
      id: null,
      error: { code: -32000, message: "Use POST." },
    },
    405,
    { Allow: "POST, OPTIONS" },
  );
}

export const GET = notAllowed;
export const DELETE = notAllowed;
export const OPTIONS = preflight;
