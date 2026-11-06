import { describe, expect, it } from "vitest";
import type { DiscordMessage } from "./format";
import { sendDiscordMessages } from "./send";

const base = { webhookId: "123", webhookToken: "SECRET-TOKEN", guildId: "g1" };
const msg = (
  content: string,
  over: Partial<DiscordMessage> = {},
): DiscordMessage => ({
  content,
  username: "Buffer",
  allowed_mentions: { parse: [] },
  ...over,
});
const created = (id: string) => Response.json({ id, channel_id: "ch1" });
const MIB = 1024 * 1024;
const file = (n: number, alt = `image ${n}`) => ({
  url: `https://i.example/${n}.png`,
  filename: `image-${n}.png`,
  alt,
  mimeType: "image/png",
});
/** Records the one request body sent. */
function capture() {
  const sent: { body: string | FormData | null } = { body: null };
  const fetchImpl = (async (_u: string, init: RequestInit) => {
    sent.body = init.body as string | FormData;
    return created("m1");
  }) as unknown as typeof fetch;
  const payload = () =>
    JSON.parse(
      typeof sent.body === "string"
        ? sent.body
        : String(sent.body?.get("payload_json")),
    ) as {
      embeds?: { image: { url: string } }[];
      attachments?: { id: number; filename: string; description: string }[];
    };
  return { sent, fetchImpl, payload };
}

describe("sendDiscordMessages", () => {
  it("returns the message link and posts to the webhook url", async () => {
    const urls: string[] = [];
    const fetchImpl = (async (u: string) => {
      urls.push(u);
      return created(`m${urls.length}`);
    }) as unknown as typeof fetch;
    const r = await sendDiscordMessages({
      ...base,
      messages: [msg("a"), msg("b")],
      fetchImpl,
    });
    expect(r).toEqual({
      ok: true,
      url: "https://discord.com/channels/g1/ch1/m1",
    });
    expect(urls).toHaveLength(2);
    expect(urls[0]).toBe(
      "https://discord.com/api/webhooks/123/SECRET-TOKEN?wait=true&with_components=true",
    );
  });

  it("resumes from startAt", async () => {
    const bodies: string[] = [];
    const fetchImpl = (async (_u: string, init: RequestInit) => {
      bodies.push(String(init.body));
      return created("m2");
    }) as unknown as typeof fetch;
    const r = await sendDiscordMessages({
      ...base,
      messages: [msg("one"), msg("two")],
      startAt: 1,
      fetchImpl,
    });
    expect(bodies).toHaveLength(1);
    expect(JSON.parse(bodies[0]!).content).toBe("two");
    expect(r.ok).toBe(true);
  });

  it("sends alt text as attachment descriptions", async () => {
    let form: FormData | null = null;
    const fetchImpl = (async (_u: string, init: RequestInit) => {
      form = init.body as FormData;
      return created("m1");
    }) as unknown as typeof fetch;
    const fetchImageImpl = (async () => ({
      bytes: new Uint8Array([1, 2]),
      mimeType: "image/png",
    })) as never;
    await sendDiscordMessages({
      ...base,
      messages: [
        msg("pics", {
          files: [
            {
              url: "https://i.example/1.png",
              filename: "image-1.png",
              alt: "a cat",
              mimeType: "image/png",
            },
          ],
        }),
      ],
      fetchImpl,
      fetchImageImpl,
    });
    const payload = JSON.parse(String(form!.get("payload_json")));
    expect(payload.attachments).toEqual([
      { id: 0, filename: "image-1.png", description: "a cat" },
    ]);
    expect(payload.files).toBeUndefined();
    expect(form!.get("files[0]")).toBeInstanceOf(Blob);
  });

  it("falls back to an embed when an image can't be fetched", async () => {
    let body: unknown = null;
    const fetchImpl = (async (_u: string, init: RequestInit) => {
      body = init.body;
      return created("m1");
    }) as unknown as typeof fetch;
    const fetchImageImpl = (async () => null) as never;
    await sendDiscordMessages({
      ...base,
      messages: [
        msg("pics", {
          files: [
            {
              url: "https://i.example/1.png",
              filename: "image-1.png",
              alt: "x",
              mimeType: "image/png",
            },
          ],
        }),
      ],
      fetchImpl,
      fetchImageImpl,
    });
    expect(typeof body).toBe("string");
    expect(JSON.parse(body as string).embeds).toEqual([
      { image: { url: "https://i.example/1.png" } },
    ]);
  });

  it("truncates alt text to 1024 characters", async () => {
    const { fetchImpl, payload } = capture();
    const fetchImageImpl = (async () => ({
      bytes: new Uint8Array([1]),
      mimeType: "image/png",
    })) as never;
    // Each cat is two UTF-16 code units: the cut must not split one.
    await sendDiscordMessages({
      ...base,
      messages: [
        msg("pics", { files: [file(1, "🐱".repeat(1030)), file(2, "short")] }),
      ],
      fetchImpl,
      fetchImageImpl,
    });
    const [long, short] = payload().attachments!;
    expect(long!.description).toBe("🐱".repeat(1024));
    expect(short!.description).toBe("short");
  });

  it("turns images past the upload budget into embeds", async () => {
    const { sent, fetchImpl, payload } = capture();
    const sizes: Record<string, number> = {
      "https://i.example/1.png": 4 * MIB,
      "https://i.example/2.png": 4 * MIB,
      "https://i.example/3.png": 4 * MIB,
      "https://i.example/4.png": 1 * MIB,
    };
    const fetchImageImpl = (async (url: string) => ({
      bytes: new Uint8Array(sizes[url]!),
      mimeType: "image/png",
    })) as never;
    await sendDiscordMessages({
      ...base,
      messages: [msg("pics", { files: [1, 2, 3, 4].map((n) => file(n)) })],
      fetchImpl,
      fetchImageImpl,
    });
    // 4 + 4 MiB fit in 9.5; a third 4 MiB would not, but the 1 MiB one does.
    expect(payload().attachments).toEqual([
      { id: 0, filename: "image-1.png", description: "image 1" },
      { id: 1, filename: "image-2.png", description: "image 2" },
      { id: 2, filename: "image-4.png", description: "image 4" },
    ]);
    expect(payload().embeds).toEqual([
      { image: { url: "https://i.example/3.png" } },
    ]);
    const form = sent.body as FormData;
    expect(form.get("files[2]")).toBeInstanceOf(Blob);
    expect(form.get("files[3]")).toBeNull();
  });

  it("never sends more than 10 embeds", async () => {
    const { fetchImpl, payload } = capture();
    const thumbnail = { image: { url: "https://v.example/t.jpg" } };
    await sendDiscordMessages({
      ...base,
      messages: [
        msg("pics", {
          embeds: [thumbnail],
          files: Array.from({ length: 10 }, (_, i) => file(i + 1)),
        }),
      ],
      fetchImpl,
      fetchImageImpl: (async () => null) as never,
    });
    const embeds = payload().embeds!;
    expect(embeds).toHaveLength(10);
    expect(embeds[0]).toEqual(thumbnail);
    expect(embeds.slice(1).map((e) => e.image.url)).toEqual(
      Array.from({ length: 9 }, (_, i) => `https://i.example/${i + 1}.png`),
    );
  });

  it("maps 429 to retryAfterMs with sentCount", async () => {
    let n = 0;
    const fetchImpl = (async () =>
      ++n === 1
        ? created("m1")
        : Response.json(
            { retry_after: 1.5 },
            { status: 429 },
          )) as unknown as typeof fetch;
    const r = await sendDiscordMessages({
      ...base,
      messages: [msg("a"), msg("b")],
      fetchImpl,
    });
    expect(r).toMatchObject({
      ok: false,
      retryable: true,
      retryAfterMs: 1500,
      sentCount: 1,
    });
  });

  it("maps 404 and 401 to a broken destination", async () => {
    for (const status of [404, 401]) {
      const fetchImpl = (async () =>
        Response.json(
          { message: "Unknown Webhook" },
          { status },
        )) as unknown as typeof fetch;
      const r = await sendDiscordMessages({
        ...base,
        messages: [msg("a")],
        fetchImpl,
      });
      expect(r).toMatchObject({
        ok: false,
        retryable: false,
        destinationBroken: true,
        sentCount: 0,
      });
    }
  });

  it("maps 400 to a non-retryable failure with Discord's message", async () => {
    const fetchImpl = (async () =>
      Response.json(
        { message: "Invalid Form Body" },
        { status: 400 },
      )) as unknown as typeof fetch;
    const r = await sendDiscordMessages({
      ...base,
      messages: [msg("a")],
      fetchImpl,
    });
    expect(r).toMatchObject({ ok: false, retryable: false });
    expect(r.ok === false && r.reason).toContain("Invalid Form Body");
  });

  it("retries 5xx and network failures without leaking the token", async () => {
    const f5 = (async () =>
      new Response("x", { status: 502 })) as unknown as typeof fetch;
    const fNet = (async () => {
      throw new Error(
        "failed https://discord.com/api/webhooks/123/SECRET-TOKEN",
      );
    }) as unknown as typeof fetch;
    for (const fetchImpl of [f5, fNet]) {
      const r = await sendDiscordMessages({
        ...base,
        messages: [msg("a")],
        fetchImpl,
      });
      expect(r).toMatchObject({ ok: false, retryable: true, sentCount: 0 });
      expect(JSON.stringify(r)).not.toContain("SECRET-TOKEN");
    }
  });
});
