/**
 * The Model Context Protocol over Streamable HTTP, written by hand (the
 * dependency rule keeps the SDK out). Ferry answers each POST with one JSON
 * response and never opens a session or a stream, so any server instance
 * can take any request. Revisions 2025-03-26 to 2025-11-25 share this wire
 * format. A 2026-07-28 client probes with server/discover, gets
 * method-not-found, and falls back to initialize.
 */

export const PROTOCOL_VERSIONS = [
  "2025-11-25",
  "2025-06-18",
  "2025-03-26",
] as const;
const LATEST = PROTOCOL_VERSIONS[0];

type JsonObject = Record<string, unknown>;

export type ToolOutcome =
  | { ok: true; data: JsonObject }
  /** Shown to the model, which can fix its call and try again. */
  | { ok: false; message: string };

export interface McpTool<C> {
  /** The tools/list entry, as sent. */
  definition: { name: string } & JsonObject;
  run(args: JsonObject, ctx: C): Promise<ToolOutcome>;
}

export interface McpServer<C> {
  info: { name: string; title: string; version: string } & JsonObject;
  instructions: string;
  tools: McpTool<C>[];
}

export interface McpReply {
  /** 202 carries no body. */
  status: 200 | 202 | 400;
  /** One response, or a batch's responses. */
  body: JsonObject | JsonObject[] | null;
}

const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;

type Id = string | number | null;

const rpcError = (id: Id, code: number, message: string): JsonObject => ({
  jsonrpc: "2.0",
  id,
  error: { code, message },
});
const rpcResult = (id: Id, result: JsonObject): JsonObject => ({
  jsonrpc: "2.0",
  id,
  result,
});
const bad = (id: Id, code: number, message: string): McpReply => ({
  status: 400,
  body: rpcError(id, code, message),
});
const ok = (body: JsonObject): McpReply => ({ status: 200, body });

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function supported(
  version: unknown,
): version is (typeof PROTOCOL_VERSIONS)[number] {
  return (PROTOCOL_VERSIONS as readonly unknown[]).includes(version);
}

/** A tool's text block repeats its structured result, for clients that read only text. */
function toolResult(outcome: ToolOutcome): JsonObject {
  return outcome.ok
    ? {
        content: [{ type: "text", text: JSON.stringify(outcome.data) }],
        structuredContent: outcome.data,
      }
    : { content: [{ type: "text", text: outcome.message }], isError: true };
}

async function callTool<C>(
  server: McpServer<C>,
  id: Id,
  params: JsonObject,
  ctx: C,
): Promise<McpReply> {
  const name = params.name;
  const tool = server.tools.find((t) => t.definition.name === name);
  if (typeof name !== "string" || !tool)
    return ok(rpcError(id, INVALID_PARAMS, `Unknown tool: ${String(name)}`));
  const args = params.arguments ?? {};
  if (!isObject(args))
    return ok(rpcError(id, INVALID_PARAMS, "arguments must be an object"));
  let outcome: ToolOutcome;
  try {
    outcome = await tool.run(args, ctx);
  } catch (err) {
    // The name only: a message could quote stored data.
    console.error(
      `ferry: MCP tool ${name} failed (${err instanceof Error ? err.name : "UnknownError"})`,
    );
    // A tool that changes things may have got part way, so trying again
    // blind could send a post twice.
    const readOnly =
      isObject(tool.definition.annotations) &&
      tool.definition.annotations.readOnlyHint === true;
    outcome = {
      ok: false,
      message: readOnly
        ? "Ferry couldn't read that just now. Try again in a moment."
        : "Ferry couldn't finish that just now. It may have gone through anyway, so check before trying again.",
    };
  }
  return ok(rpcResult(id, toolResult(outcome)));
}

const MAX_BATCH = 20;

/**
 * One POST body in, one reply out. `protocolHeader` is the request's
 * MCP-Protocol-Version header, which every request after initialize
 * carries from 2025-06-18 on. Without it, a request counts as 2025-03-26.
 */
export async function handleMcpPost<C>(
  server: McpServer<C>,
  body: string,
  protocolHeader: string | null,
  ctx: C,
): Promise<McpReply> {
  let message: unknown;
  try {
    message = JSON.parse(body);
  } catch {
    return bad(null, PARSE_ERROR, "Parse error");
  }
  if (!Array.isArray(message))
    return handleMessage(server, message, protocolHeader, ctx);
  // 2025-03-26 allowed batches, and 2025-06-18 took them out.
  if (protocolHeader !== null && protocolHeader !== "2025-03-26")
    return bad(null, INVALID_REQUEST, "Send one JSON-RPC message per request.");
  if (message.length === 0 || message.length > MAX_BATCH)
    return bad(
      null,
      INVALID_REQUEST,
      `Send 1 to ${MAX_BATCH} messages in a batch.`,
    );
  const replies: JsonObject[] = [];
  for (const one of message) {
    const reply = await handleMessage(server, one, protocolHeader, ctx);
    if (reply.body !== null && !Array.isArray(reply.body))
      replies.push(reply.body);
  }
  // Only notifications and responses: nothing to answer.
  return replies.length === 0
    ? { status: 202, body: null }
    : { status: 200, body: replies };
}

async function handleMessage<C>(
  server: McpServer<C>,
  message: unknown,
  protocolHeader: string | null,
  ctx: C,
): Promise<McpReply> {
  if (!isObject(message) || message.jsonrpc !== "2.0")
    return bad(null, INVALID_REQUEST, "Invalid Request");

  const { method, id } = message;
  if (typeof method !== "string") {
    // A client's answer to a server request. Ferry never sends any, so it
    // needs no reply.
    if ("id" in message && ("result" in message || "error" in message))
      return { status: 202, body: null };
    return bad(null, INVALID_REQUEST, "Invalid Request");
  }
  // Notifications, such as notifications/initialized, need no reply either.
  if (!("id" in message)) return { status: 202, body: null };
  if (!(
    typeof id === "string" ||
    (typeof id === "number" && Number.isFinite(id))
  ))
    return bad(null, INVALID_REQUEST, "id must be a string or a number.");

  const params = message.params ?? {};
  if (!isObject(params))
    return ok(rpcError(id, INVALID_PARAMS, "params must be an object"));

  if (method === "initialize")
    return ok(
      rpcResult(id, {
        protocolVersion: supported(params.protocolVersion)
          ? params.protocolVersion
          : LATEST,
        capabilities: { tools: { listChanged: false } },
        serverInfo: server.info,
        instructions: server.instructions,
      }),
    );

  if (protocolHeader !== null && !supported(protocolHeader))
    return bad(
      id,
      INVALID_REQUEST,
      `Unsupported MCP-Protocol-Version. Ferry speaks ${PROTOCOL_VERSIONS.join(", ")}.`,
    );

  switch (method) {
    case "ping":
      return ok(rpcResult(id, {}));
    case "tools/list":
      // One page: no cursor needed.
      return ok(
        rpcResult(id, { tools: server.tools.map((t) => t.definition) }),
      );
    case "tools/call":
      return callTool(server, id, params, ctx);
    default:
      return ok(rpcError(id, METHOD_NOT_FOUND, `Method not found: ${method}`));
  }
}
