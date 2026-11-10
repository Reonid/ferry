import { describe, expect, it } from "vitest";
import type { MirrorPost } from "../../types";
import { buildTelegramCalls } from "./format";

function mirror(over: Partial<MirrorPost> = {}): MirrorPost {
  return {
    groupKey: "g",
    postIds: ["p1"],
    text: "hello",
    threadTexts: [],
    images: [],
    video: null,
    link: null,
    permalinks: [],
    source: { channelId: "c1", service: "twitter", name: "Buffer", avatar: "" },
    publishedAt: 0,
    ...over,
  };
}
const img = (n: number) => ({
  url: `https://i.example/${n}.png`,
  alt: "",
  mimeType: "image/png",
});
const perma = [
  { service: "linkedin" as const, url: "https://li.example/1" },
  { service: "twitter" as const, url: "https://x.example/1" },
];

describe("buildTelegramCalls", () => {
  it("sends text literally with no parse mode", () => {
    const calls = buildTelegramCalls(
      mirror({
        text: "*not bold* _x_ <b>y</b>",
        threadTexts: ["two"],
        link: {
          url: "https://l.example",
          title: "",
          text: "",
          thumbnail: null,
        },
      }),
    );
    expect(calls).toEqual([
      {
        method: "sendMessage",
        params: {
          text: "*not bold* _x_ <b>y</b>\n\ntwo\n\nhttps://l.example",
        },
      },
    ]);
    expect(JSON.stringify(calls)).not.toContain("parse_mode");
  });

  it("returns nothing without text or media", () => {
    expect(buildTelegramCalls(mirror({ text: "" }))).toEqual([]);
  });

  it("splits long text at 4096", () => {
    const calls = buildTelegramCalls(
      mirror({ text: `${"a".repeat(3000)}\n\n${"b".repeat(3000)}` }),
    );
    expect(calls).toHaveLength(2);
    for (const c of calls) {
      expect(String(c.params.text).length).toBeLessThanOrEqual(4096);
      expect(c.params).not.toHaveProperty("link_preview_options");
    }
  });

  it("sends one photo with a caption that fits", () => {
    expect(buildTelegramCalls(mirror({ images: [img(1)] }))).toEqual([
      {
        method: "sendPhoto",
        params: { photo: "https://i.example/1.png", caption: "hello" },
      },
    ]);
    expect(
      buildTelegramCalls(
        mirror({
          text: "",
          video: { url: "https://v.example/1.mp4", thumbnail: "" },
        }),
      ),
    ).toEqual([
      { method: "sendVideo", params: { video: "https://v.example/1.mp4" } },
    ]);
  });

  it("sends a long caption as follow-up messages", () => {
    const calls = buildTelegramCalls(
      mirror({ text: "x".repeat(1500), images: [img(1)] }),
    );
    expect(calls.map((c) => c.method)).toEqual(["sendPhoto", "sendMessage"]);
    expect(calls[0]!.params).toEqual({ photo: "https://i.example/1.png" });
    expect(calls[1]!.params).toMatchObject({
      link_preview_options: { is_disabled: true },
    });
  });

  it("groups photos and a video and puts View on lines in the caption", () => {
    const calls = buildTelegramCalls(
      mirror({
        images: [img(1), img(2)],
        video: { url: "https://v.example/1.mp4", thumbnail: "" },
        permalinks: perma,
      }),
    );
    expect(calls).toEqual([
      {
        method: "sendMediaGroup",
        params: {
          media: [
            {
              type: "photo",
              media: "https://i.example/1.png",
              caption:
                "hello\n\nView on LinkedIn: https://li.example/1\nView on X: https://x.example/1",
            },
            { type: "photo", media: "https://i.example/2.png" },
            { type: "video", media: "https://v.example/1.mp4" },
          ],
        },
      },
    ]);
  });

  it("caps media at 10 and omits an empty caption", () => {
    const calls = buildTelegramCalls(
      mirror({
        text: "",
        images: Array.from({ length: 12 }, (_, n) => img(n)),
      }),
    );
    const media = calls[0]!.params.media as Record<string, unknown>[];
    expect(media).toHaveLength(10);
    expect(media[0]).not.toHaveProperty("caption");
  });

  it("puts View on buttons on the last message", () => {
    const calls = buildTelegramCalls(
      mirror({
        text: `${"a".repeat(3000)}\n\n${"b".repeat(3000)}`,
        permalinks: [...perma, ...perma],
      }),
    );
    expect(calls[0]!.params).not.toHaveProperty("reply_markup");
    expect(calls[1]!.params.reply_markup).toEqual({
      inline_keyboard: [
        [{ text: "View on LinkedIn", url: "https://li.example/1" }],
        [{ text: "View on X", url: "https://x.example/1" }],
        [{ text: "View on LinkedIn", url: "https://li.example/1" }],
      ],
    });
    const photo = buildTelegramCalls(
      mirror({ images: [img(1)], permalinks: perma }),
    );
    expect(photo[0]!.params).toHaveProperty("reply_markup");
  });

  it("keeps a group's follow-up message and buttons when the caption is too long", () => {
    const calls = buildTelegramCalls(
      mirror({
        text: "x".repeat(1100),
        images: [img(1), img(2)],
        permalinks: perma,
      }),
    );
    expect(calls.map((c) => c.method)).toEqual([
      "sendMediaGroup",
      "sendMessage",
    ]);
    expect(calls[0]!.params).not.toHaveProperty("reply_markup");
    expect(calls[1]!.params).toHaveProperty("reply_markup");
  });
});
