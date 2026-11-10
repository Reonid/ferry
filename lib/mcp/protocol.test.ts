import { afterEach, describe, expect, it, vi } from "vitest";
import { handleMcpPost, type McpServer } from "./protocol";

const server: McpServer<{ who: string }> = {
  info: { name: "test", title: "Test", version: "1.0.0" },
  instructions: "Be nice.",
  tools: [
    {
      definition: { name: "echo", inputSchema: { type: "object" } },
      async run(args, ctx) {
        return { ok: true, data: { args, who: ctx.who } };
      },
    },
    {
      definition: { name: "picky", inputSchema: { type: "object" } },
      async run() {
        return { ok: false, message: "limit must be 1 to 5." };
      },
    },
    {
      definition: { name: "broken", inputSchema: { type: "object" } },
      async run() {
        throw new TypeError("secret detail");
      },
    },
  ],
};

const post = (body: unknown, header: string | null = "2025-11-25") =>
  handleMcpPost(
    server,
    typeof body === "string" ? body : JSON.stringify(body),
    header,
    { who: "acct" },
  );
const call = (method: string, params?: unknown, id: unknown = 1) =>
  post({
    jsonrpc: "2.0",
    id,
    method,
    ...(params === undefined ? {} : { params }),
  });

afterEach(() => vi.restoreAllMocks());

describe("initialize", () => {
  it("echoes a version Ferry speaks", async () => {
    for (const version of ["2025-11-25", "2025-06-18", "2025-03-26"]) {
      const reply = await post(
        {
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: version,
            capabilities: {},
            clientInfo: { name: "c", version: "1" },
          },
        },
        null,
      );
      expect(reply).toEqual({
        status: 200,
        body: {
          jsonrpc: "2.0",
          id: 1,
          result: {
            protocolVersion: version,
            capabilities: { tools: { listChanged: false } },
            serverInfo: server.info,
            instructions: "Be nice.",
          },
        },
      });
    }
  });

  it("offers the latest version for one it doesn't know", async () => {
    for (const protocolVersion of ["2024-11-05", "2026-07-28", undefined, 7]) {
      const reply = await post(
        {
          jsonrpc: "2.0",
          id: "a",
          method: "initialize",
          params: { protocolVersion },
        },
        // Even a header naming another version doesn't stop initialize.
        "2026-07-28",
      );
      expect(reply.body?.result).toMatchObject({
        protocolVersion: "2025-11-25",
      });
    }
  });
});

describe("requests after initialize", () => {
  it("lists the tools", async () => {
    const reply = await call("tools/list");
    expect(reply.status).toBe(200);
    expect(reply.body?.result).toEqual({
      tools: server.tools.map((t) => t.definition),
    });
  });

  it("calls a tool with its arguments and the context", async () => {
    const reply = await call("tools/call", {
      name: "echo",
      arguments: { limit: 3 },
    });
    const data = { args: { limit: 3 }, who: "acct" };
    expect(reply.body?.result).toEqual({
      content: [{ type: "text", text: JSON.stringify(data) }],
      structuredContent: data,
    });
  });

  it("defaults missing arguments to an empty object", async () => {
    const reply = await call("tools/call", { name: "echo" });
    expect(reply.body?.result).toMatchObject({
      structuredContent: { args: {} },
    });
  });

  it("returns a tool's refusal as a tool error the model can read", async () => {
    const reply = await call("tools/call", { name: "picky" });
    expect(reply).toEqual({
      status: 200,
      body: {
        jsonrpc: "2.0",
        id: 1,
        result: {
          content: [{ type: "text", text: "limit must be 1 to 5." }],
          isError: true,
        },
      },
    });
  });

  it("turns a throw into a tool error and logs only its name", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const reply = await call("tools/call", { name: "broken" });
    expect(reply.body?.result).toMatchObject({ isError: true });
    expect(JSON.stringify(reply.body)).not.toContain("secret detail");
    expect(log).toHaveBeenCalledWith(
      "ferry: MCP tool broken failed (TypeError)",
    );
  });

  it("answers unknown tools and bad params with -32602", async () => {
    for (const params of [
      { name: "nope" },
      {},
      { name: "echo", arguments: [1] },
      { name: "echo", arguments: "x" },
    ]) {
      const reply = await call("tools/call", params);
      expect(reply.status).toBe(200);
      expect(reply.body?.error, JSON.stringify(params)).toMatchObject({
        code: -32602,
      });
    }
    expect((await call("tools/list", [1])).body?.error).toMatchObject({
      code: -32602,
    });
  });

  it("answers ping", async () => {
    expect((await call("ping")).body).toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: {},
    });
  });

  it("answers unknown methods, server/discover among them, with -32601", async () => {
    for (const method of [
      "resources/list",
      "prompts/list",
      "server/discover",
    ]) {
      const reply = await call(method);
      expect(reply.status).toBe(200);
      expect(reply.body?.error, method).toMatchObject({ code: -32601 });
    }
  });

  it("refuses a protocol version header it doesn't speak", async () => {
    const reply = await post(
      { jsonrpc: "2.0", id: 9, method: "tools/list" },
      "2099-01-01",
    );
    expect(reply.status).toBe(400);
    expect(reply.body).toMatchObject({ id: 9, error: { code: -32600 } });
  });

  it("treats a request with no version header as 2025-03-26", async () => {
    const reply = await post(
      { jsonrpc: "2.0", id: 1, method: "tools/list" },
      null,
    );
    expect(reply.status).toBe(200);
  });
});

describe("JSON-RPC framing", () => {
  it("accepts notifications and client responses with 202 and no body", async () => {
    for (const message of [
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", method: "notifications/cancelled", params: {} },
      { jsonrpc: "2.0", id: 4, result: {} },
      { jsonrpc: "2.0", id: 4, error: { code: 1, message: "x" } },
    ])
      expect(await post(message)).toEqual({ status: 202, body: null });
  });

  it("refuses bad JSON, batches and other shapes with 400", async () => {
    const cases: [unknown, number][] = [
      ["{not json", -32700],
      [[{ jsonrpc: "2.0", id: 1, method: "ping" }], -32600],
      [{ id: 1, method: "ping" }, -32600],
      [{ jsonrpc: "1.0", id: 1, method: "ping" }, -32600],
      [{ jsonrpc: "2.0", id: 1, method: 5 }, -32600],
      [{ jsonrpc: "2.0", id: null, method: "ping" }, -32600],
      [{ jsonrpc: "2.0", id: { x: 1 }, method: "ping" }, -32600],
      ["null", -32600],
    ];
    for (const [body, code] of cases) {
      const reply = await post(body);
      expect(reply.status, JSON.stringify(body)).toBe(400);
      expect(reply.body, JSON.stringify(body)).toMatchObject({
        jsonrpc: "2.0",
        id: null,
        error: { code },
      });
    }
  });

  it("keeps string ids as they are", async () => {
    expect((await call("ping", undefined, "req-7")).body?.id).toBe("req-7");
  });
});
