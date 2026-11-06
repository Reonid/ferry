import { describe, expect, it, vi } from "vitest";
import { BufferError, bufferRequest } from "./client";

const TOKEN = "super-secret-token-123";

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}
async function failure(fetchImpl: typeof fetch): Promise<BufferError> {
  try {
    await bufferRequest({
      accessToken: TOKEN,
      query: "{ account { id } }",
      now: 1,
      fetchImpl,
    });
  } catch (e) {
    return e as BufferError;
  }
  throw new Error("expected bufferRequest to throw");
}

describe("bufferRequest", () => {
  it("sends a bearer token", async () => {
    const fetchImpl = vi.fn(async () => json({ data: { ok: 1 } }));
    await bufferRequest({
      accessToken: "tok",
      query: "{ a }",
      variables: { x: 1 },
      now: 1,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://api.buffer.com");
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer tok");
    expect(JSON.parse(init.body as string)).toEqual({
      query: "{ a }",
      variables: { x: 1 },
    });
  });

  it("maps 401 to auth", async () => {
    const e = await failure(
      (async () => new Response("no", { status: 401 })) as typeof fetch,
    );
    expect(e).toBeInstanceOf(BufferError);
    expect(e.kind).toBe("auth");
    expect(e.status).toBe(401);
  });

  it("maps 429 with Retry-After 30 to rate_limit and 30000 ms", async () => {
    const e = await failure(
      (async () =>
        new Response("slow", {
          status: 429,
          headers: { "retry-after": "30" },
        })) as typeof fetch,
    );
    expect(e.kind).toBe("rate_limit");
    expect(e.retryAfterMs).toBe(30000);
  });

  it("reads Retry-After on a GraphQL rate-limit error", async () => {
    const e = await failure((async () =>
      json(
        {
          errors: [
            {
              message: "Too many requests",
              extensions: { code: "RATE_LIMIT_EXCEEDED" },
            },
          ],
        },
        {
          headers: { "content-type": "application/json", "retry-after": "45" },
        },
      )) as typeof fetch);
    expect(e.kind).toBe("rate_limit");
    expect(e.retryAfterMs).toBe(45_000);

    const bare = await failure((async () =>
      json({
        errors: [{ message: "slow", extensions: { code: "RATE_LIMITED" } }],
      })) as typeof fetch);
    expect(bare.kind).toBe("rate_limit");
    expect(bare.retryAfterMs).toBeUndefined();
  });

  it("maps an UNAUTHENTICATED GraphQL error to auth", async () => {
    const e = await failure((async () =>
      json({
        errors: [
          { message: "bad token", extensions: { code: "UNAUTHENTICATED" } },
        ],
      })) as typeof fetch);
    expect(e.kind).toBe("auth");
  });

  it("maps other GraphQL errors and 5xx to api", async () => {
    const g = await failure((async () =>
      json({ errors: [{ message: "nope" }] })) as typeof fetch);
    expect(g.kind).toBe("api");
    expect(g.message).toBe("nope");
    const s = await failure(
      (async () => new Response("x", { status: 502 })) as typeof fetch,
    );
    expect(s.kind).toBe("api");
    expect(s.status).toBe(502);
  });

  it("maps a thrown fetch to network", async () => {
    const e = await failure((async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch);
    expect(e.kind).toBe("network");
  });

  it("returns data and the parsed RateLimit header", async () => {
    const res = await bufferRequest<{ ok: number }>({
      accessToken: "tok",
      query: "{ a }",
      now: 42,
      fetchImpl: (async () =>
        json(
          { data: { ok: 1 } },
          { headers: { ratelimit: '"15m";r=98;t=840' } },
        )) as typeof fetch,
    });
    expect(res.data).toEqual({ ok: 1 });
    expect(res.rateLimit).toEqual({
      observedAt: 42,
      windows: [{ name: "15m", remaining: 98, resetSeconds: 840 }],
    });
  });

  it("never puts the token in an error message", async () => {
    const echoing = [
      (async () => {
        throw new Error(`connect failed for Bearer ${TOKEN}`);
      }) as typeof fetch,
      (async () =>
        json({ errors: [{ message: `bad ${TOKEN}` }] })) as typeof fetch,
      (async () => new Response(TOKEN, { status: 401 })) as typeof fetch,
      (async () => new Response(TOKEN, { status: 500 })) as typeof fetch,
    ];
    for (const f of echoing) {
      const e = await failure(f);
      expect(e.message).not.toContain(TOKEN);
      expect(JSON.stringify(e)).not.toContain(TOKEN);
      expect(String((e as { cause?: unknown }).cause ?? "")).not.toContain(
        TOKEN,
      );
    }
  });
});
