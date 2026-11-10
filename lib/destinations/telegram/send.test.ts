import { describe, expect, it } from "vitest";
import type { TelegramCall } from "./format";
import { sendTelegramMessages } from "./send";

const token = "123456:SECRET-token";
const base = { token, chatId: "-1001234", username: null };
const text = (t: string): TelegramCall => ({
  method: "sendMessage",
  params: { text: t },
});
type Reply = Response | Error;
/** Replays replies in order and records each request. */
function script(...replies: Reply[]) {
  const seen: { method: string; body: Record<string, unknown> }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    seen.push({
      method: url.split("/").pop()!,
      body: JSON.parse(String(init.body)),
    });
    const r = replies[seen.length - 1] ?? replies.at(-1)!;
    if (r instanceof Error) throw r;
    return r.clone();
  }) as unknown as typeof fetch;
  return { seen, fetchImpl };
}
const okMsg = (id: number) =>
  Response.json({ ok: true, result: { message_id: id } });
const err = (
  status: number,
  description: string,
  parameters?: Record<string, unknown>,
) =>
  Response.json(
    { ok: false, error_code: status, description, parameters },
    { status },
  );
const photo: TelegramCall = {
  method: "sendPhoto",
  params: {
    photo: "https://i.example/1.png",
    caption: "cap",
    reply_markup: {
      inline_keyboard: [[{ text: "View on X", url: "https://x" }]],
    },
  },
};

describe("sendTelegramMessages", () => {
  it("returns ok with no calls", async () => {
    expect(await sendTelegramMessages({ ...base, calls: [] })).toEqual({
      ok: true,
    });
  });

  it("sends each call with the chat id and links the first message", async () => {
    const s = script(okMsg(5), okMsg(6));
    const out = await sendTelegramMessages({
      ...base,
      calls: [text("a"), text("b")],
      fetchImpl: s.fetchImpl,
    });
    expect(s.seen.map((x) => x.body)).toEqual([
      { chat_id: "-1001234", text: "a" },
      { chat_id: "-1001234", text: "b" },
    ]);
    expect(out).toEqual({ ok: true, url: "https://t.me/c/1234/5" });
  });

  it("builds public and private message links", async () => {
    const run = (chatId: string, username: string | null) =>
      sendTelegramMessages({
        token,
        chatId,
        username,
        calls: [text("a")],
        fetchImpl: script(okMsg(9)).fetchImpl,
      });
    expect(await run("-1001234", "mychan")).toEqual({
      ok: true,
      url: "https://t.me/mychan/9",
    });
    expect(await run("-1001234", null)).toEqual({
      ok: true,
      url: "https://t.me/c/1234/9",
    });
    expect(await run("42", null)).toEqual({ ok: true });
  });

  it("uses the first id of a media group result", async () => {
    const s = script(
      Response.json({
        ok: true,
        result: [{ message_id: 11 }, { message_id: 12 }],
      }),
    );
    const out = await sendTelegramMessages({
      ...base,
      username: "u",
      calls: [{ method: "sendMediaGroup", params: { media: [] } }],
      fetchImpl: s.fetchImpl,
    });
    expect(out).toEqual({ ok: true, url: "https://t.me/u/11" });
  });

  it("resumes from startAt", async () => {
    const s = script(okMsg(3), err(500, "boom"));
    const out = await sendTelegramMessages({
      ...base,
      calls: [text("a"), text("b"), text("c")],
      startAt: 1,
      fetchImpl: s.fetchImpl,
    });
    expect(s.seen.map((x) => x.body.text)).toEqual(["b", "c"]);
    expect(out).toMatchObject({ ok: false, retryable: true, sentCount: 2 });
  });

  it("maps 429 retry_after to retryAfterMs", async () => {
    const out = await sendTelegramMessages({
      ...base,
      calls: [text("a")],
      fetchImpl: script(err(429, "Too Many Requests", { retry_after: 7 }))
        .fetchImpl,
    });
    expect(out).toEqual({
      ok: false,
      retryable: true,
      reason: "Telegram rate limit",
      retryAfterMs: 7000,
      sentCount: 0,
    });
    const bare = await sendTelegramMessages({
      ...base,
      calls: [text("a")],
      fetchImpl: script(err(429, "Too Many Requests")).fetchImpl,
    });
    expect(bare).toMatchObject({ ok: false, retryable: true });
    expect(bare).not.toHaveProperty("retryAfterMs");
  });

  it("maps 403 and chat-not-found to a broken destination", async () => {
    for (const r of [
      err(403, "Forbidden: bot was blocked by the user"),
      err(400, "Bad Request: chat not found"),
      err(400, "Bad Request: have no rights to send a message"),
    ]) {
      const out = await sendTelegramMessages({
        ...base,
        calls: [photo],
        fetchImpl: script(r).fetchImpl,
      });
      expect(out).toMatchObject({
        ok: false,
        retryable: false,
        destinationBroken: true,
        sentCount: 0,
      });
    }
  });

  it("maps a supergroup migration to a broken destination", async () => {
    const s = script(
      err(400, "Bad Request: group chat was upgraded to a supergroup chat", {
        migrate_to_chat_id: -1009999,
      }),
    );
    const out = await sendTelegramMessages({
      ...base,
      calls: [photo],
      fetchImpl: s.fetchImpl,
    });
    expect(out).toEqual({
      ok: false,
      retryable: false,
      reason: "This Telegram group became a supergroup. Connect it again.",
      destinationBroken: true,
      sentCount: 0,
    });
    expect(s.seen).toHaveLength(1);
  });

  it("falls back to text when Telegram can't fetch a photo", async () => {
    const s = script(
      err(400, "Bad Request: wrong file identifier/HTTP URL"),
      okMsg(8),
    );
    const out = await sendTelegramMessages({
      ...base,
      calls: [photo, text("next")],
      fetchImpl: s.fetchImpl,
    });
    expect(s.seen[1]).toEqual({
      method: "sendMessage",
      body: {
        chat_id: "-1001234",
        text: "cap\n\nhttps://i.example/1.png",
        reply_markup: photo.params.reply_markup,
      },
    });
    expect(s.seen).toHaveLength(3);
    expect(out).toEqual({ ok: true, url: "https://t.me/c/1234/8" });
  });

  it("falls back to text when the group forbids media", async () => {
    const s = script(
      err(400, "Bad Request: not enough rights to send photos to the chat"),
      okMsg(8),
    );
    const out = await sendTelegramMessages({
      ...base,
      calls: [photo],
      fetchImpl: s.fetchImpl,
    });
    expect(s.seen.map((x) => x.method)).toEqual(["sendPhoto", "sendMessage"]);
    expect(s.seen[1]!.body.text).toBe("cap\n\nhttps://i.example/1.png");
    expect(out).toEqual({ ok: true, url: "https://t.me/c/1234/8" });

    // A group that forbids text too can't take posts at all.
    const muted = await sendTelegramMessages({
      ...base,
      calls: [photo],
      fetchImpl: script(
        err(400, "Bad Request: not enough rights to send photos to the chat"),
        err(
          400,
          "Bad Request: not enough rights to send text messages to the chat",
        ),
      ).fetchImpl,
    });
    expect(muted).toMatchObject({
      ok: false,
      retryable: false,
      destinationBroken: true,
      sentCount: 0,
    });
  });

  it("falls back for a media group using the first caption and every url", async () => {
    const s = script(
      err(400, "Bad Request: failed to get HTTP URL content"),
      okMsg(1),
    );
    await sendTelegramMessages({
      ...base,
      calls: [
        {
          method: "sendMediaGroup",
          params: {
            media: [
              { type: "photo", media: "https://a", caption: "cap" },
              { type: "video", media: "https://b" },
            ],
          },
        },
      ],
      fetchImpl: s.fetchImpl,
    });
    expect(s.seen[1]!.body.text).toBe("cap\n\nhttps://a\nhttps://b");
  });

  it("does not fall back twice, and a plain 400 on text is final", async () => {
    const twice = await sendTelegramMessages({
      ...base,
      calls: [photo],
      fetchImpl: script(err(400, "bad url"), err(400, "still bad")).fetchImpl,
    });
    expect(twice).toEqual({
      ok: false,
      retryable: false,
      reason: "Telegram rejected the message: still bad",
      sentCount: 0,
    });
    const s = script(err(400, "Bad Request: message is too long"));
    const plain = await sendTelegramMessages({
      ...base,
      calls: [text("a")],
      fetchImpl: s.fetchImpl,
    });
    expect(plain).toMatchObject({ ok: false, retryable: false });
    expect(s.seen).toHaveLength(1);
  });

  it("maps 5xx and network errors to retryable failures", async () => {
    expect(
      await sendTelegramMessages({
        ...base,
        calls: [text("a")],
        fetchImpl: script(err(502, "Bad Gateway")).fetchImpl,
      }),
    ).toMatchObject({
      retryable: true,
      reason: "Telegram server error (HTTP 502)",
    });
    expect(
      await sendTelegramMessages({
        ...base,
        calls: [text("a")],
        fetchImpl: script(new Error("x")).fetchImpl,
      }),
    ).toMatchObject({ retryable: true, reason: "Could not reach Telegram" });
  });

  it("never puts the bot token in a reason", async () => {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const replies: Reply[] = [
      err(400, "Bad Request: nope"),
      err(403, "Forbidden"),
      err(429, "Too Many Requests", { retry_after: 1 }),
      err(503, "Unavailable"),
      new Response("not json", { status: 404 }),
      new Error(`fetch failed for ${url}`),
    ];
    for (const r of replies) {
      const out = await sendTelegramMessages({
        ...base,
        calls: [text("a")],
        fetchImpl: script(r).fetchImpl,
      });
      expect(out.ok).toBe(false);
      const reason = out.ok ? "" : out.reason;
      expect(reason).not.toContain("SECRET");
      expect(reason).not.toContain("api.telegram.org");
    }
  });
});
