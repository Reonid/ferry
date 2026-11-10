import { describe, expect, it } from "vitest";
import { telegramCall } from "./api";

const token = "123456:SECRET-token";

describe("telegramCall", () => {
  it("posts JSON to the bot method and returns the result", async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return Response.json({ ok: true, result: { message_id: 7 } });
    }) as unknown as typeof fetch;
    const res = await telegramCall<{ message_id: number }>({
      token,
      method: "sendMessage",
      params: { chat_id: "1", text: "hi" },
      fetchImpl,
    });
    expect(res).toEqual({ ok: true, result: { message_id: 7 } });
    expect(seen!.url).toBe(`https://api.telegram.org/bot${token}/sendMessage`);
    expect(seen!.init.method).toBe("POST");
    expect(JSON.parse(String(seen!.init.body))).toEqual({
      chat_id: "1",
      text: "hi",
    });
  });

  it("reads description, retry_after and migration from the error", async () => {
    const fetchImpl = (async () =>
      Response.json(
        {
          ok: false,
          error_code: 429,
          description: "Too Many Requests",
          parameters: { retry_after: 3, migrate_to_chat_id: -100123 },
        },
        { status: 429 },
      )) as unknown as typeof fetch;
    expect(
      await telegramCall({ token, method: "m", params: {}, fetchImpl }),
    ).toEqual({
      ok: false,
      status: 429,
      description: "Too Many Requests",
      retryAfterMs: 3000,
      migrated: true,
    });
  });

  it("uses HTTP <status> when the body is not JSON", async () => {
    const fetchImpl = (async () =>
      new Response("<html>", { status: 502 })) as unknown as typeof fetch;
    expect(
      await telegramCall({ token, method: "m", params: {}, fetchImpl }),
    ).toEqual({
      ok: false,
      status: 502,
      description: "HTTP 502",
      retryAfterMs: null,
      migrated: false,
    });
  });

  it("turns a thrown fetch into a network result without its message", async () => {
    const fetchImpl = (async (url: string) => {
      throw new Error(`failed ${url}`);
    }) as unknown as typeof fetch;
    const res = await telegramCall({
      token,
      method: "m",
      params: {},
      fetchImpl,
    });
    expect(res).toEqual({
      ok: false,
      status: 0,
      description: "network",
      retryAfterMs: null,
      migrated: false,
    });
  });
});
