import { describe, expect, it } from "vitest";
import { readBody } from "./http";

/** A body sent in 1 KB chunks with no Content-Length, counting what's read. */
function chunked(chunks: number) {
  let pulled = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (pulled >= chunks) return controller.close();
      pulled++;
      controller.enqueue(new Uint8Array(1024).fill(120));
    },
  });
  const request = new Request("https://ferry.example/api/oauth/token", {
    method: "POST",
    body,
    // Node needs this for a streamed request body.
    duplex: "half",
  } as RequestInit);
  return { request, pulled: () => pulled };
}

describe("readBody", () => {
  it("returns a body within the limit", async () => {
    const { request } = chunked(4);
    expect(await readBody(request, 16 * 1024)).toBe("x".repeat(4096));
  });

  it("stops reading once a body without Content-Length passes the limit", async () => {
    const { request, pulled } = chunked(8 * 1024);
    expect(await readBody(request, 16 * 1024)).toBeNull();
    expect(pulled()).toBeLessThan(40);
  });

  it("refuses a declared length over the limit without reading", async () => {
    const request = new Request("https://ferry.example/mcp", {
      method: "POST",
      headers: { "content-length": "99999" },
      body: "{}",
    });
    expect(await readBody(request, 1024)).toBeNull();
  });

  it("reads an empty body as empty text", async () => {
    const request = new Request("https://ferry.example/mcp", {
      method: "POST",
    });
    expect(await readBody(request, 1024)).toBe("");
  });
});
