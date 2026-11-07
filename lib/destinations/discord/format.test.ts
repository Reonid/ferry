import { describe, expect, it } from "vitest";
import type { MirrorPost } from "../../types";
import {
  buildDiscordMessages,
  escapeDiscordMarkdown,
  safeUsername,
  splitContent,
} from "./format";

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
    source: {
      channelId: "c1",
      service: "twitter",
      name: "Buffer",
      avatar: "https://a.example/av.png",
    },
    publishedAt: 0,
    ...over,
  };
}

describe("escapeDiscordMarkdown", () => {
  it("escapes markdown outside URLs", () => {
    expect(escapeDiscordMarkdown("**bold** _it_")).toBe(
      "\\*\\*bold\\*\\* \\_it\\_",
    );
    expect(escapeDiscordMarkdown("# Title\n#tag ok")).toBe(
      "\\# Title\n#tag ok",
    );
    expect(escapeDiscordMarkdown("> quote")).toBe("\\> quote");
    expect(escapeDiscordMarkdown("https://ex.com/a_b*c")).toBe(
      "https://ex.com/a_b*c",
    );
  });

  it("breaks masked links", () => {
    expect(escapeDiscordMarkdown("[click](https://evil.example)")).toBe(
      "\\[click\\](https://evil.example)",
    );
  });

  it("escapes markup around a URL", () => {
    expect(escapeDiscordMarkdown("**https://x.com**")).toBe(
      "\\*\\*https://x.com\\*\\*",
    );
    expect(escapeDiscordMarkdown("||https://x.com||")).toBe(
      "\\|\\|https://x.com\\|\\|",
    );
  });

  it("keeps balanced parentheses in URLs", () => {
    const u = "https://en.wikipedia.org/wiki/Foo_(bar)";
    expect(escapeDiscordMarkdown(u)).toBe(u);
  });

  it("trims an unbalanced closing parenthesis", () => {
    expect(escapeDiscordMarkdown("(see https://x.com/a)")).toBe(
      "(see https://x.com/a)",
    );
    expect(escapeDiscordMarkdown("(see https://x.com/a_)")).toBe(
      "(see https://x.com/a\\_)",
    );
  });

  it("escapes backticks, pipes, tildes, -# and >>>", () => {
    expect(escapeDiscordMarkdown("`a` ~b~ ||c||")).toBe(
      "\\`a\\` \\~b\\~ \\|\\|c\\|\\|",
    );
    expect(escapeDiscordMarkdown("-# small")).toBe("\\-# small");
    expect(escapeDiscordMarkdown("  ## h")).toBe("  \\## h");
    expect(escapeDiscordMarkdown(">>> all")).toBe("\\>>> all");
  });
});

describe("safeUsername", () => {
  it("uses Ferry when the name mentions Discord", () => {
    expect(safeUsername("Discord Tips")).toBe("Ferry");
    expect(safeUsername("my CLYDE")).toBe("Ferry");
    expect(safeUsername("  ")).toBe("Ferry");
    expect(safeUsername(" Buffer ")).toBe("Buffer");
    expect(safeUsername("x".repeat(200))).toHaveLength(80);
  });
});

describe("splitContent", () => {
  it("returns short text unchanged", () => {
    expect(splitContent("hi")).toEqual(["hi"]);
  });
  it("splits on paragraphs first", () => {
    const a = "a".repeat(1500);
    const b = "b".repeat(1500);
    expect(splitContent(`${a}\n\n${b}`)).toEqual([a, b]);
  });
  it("splits long paragraphs on sentences", () => {
    const s = `${"w".repeat(900)}. `;
    const out = splitContent(s.repeat(5).trim());
    expect(out.length).toBe(3);
    for (const c of out) expect(c.length).toBeLessThanOrEqual(2000);
  });
});

describe("buildDiscordMessages", () => {
  it("never allows mentions", () => {
    const msgs = buildDiscordMessages(
      mirror({ text: "@everyone <@123> hi " + "x ".repeat(2000) }),
    );
    expect(msgs.length).toBeGreaterThan(1);
    for (const m of msgs) expect(m.allowed_mentions).toEqual({ parse: [] });
    expect(msgs[0]!.content.startsWith("@everyone <@123> hi")).toBe(true);
  });

  it("splits long posts without cutting a URL", () => {
    const url = "https://example.com/" + "p".repeat(60);
    const text = "word ".repeat(390) + url + " " + "word ".repeat(480);
    const msgs = buildDiscordMessages(mirror({ text: text.trim() }));
    expect(text.indexOf(url)).toBeLessThan(2000);
    expect(text.indexOf(url) + url.length).toBeGreaterThan(2000);
    expect(msgs.length).toBe(3);
    for (const m of msgs) expect(m.content.length).toBeLessThanOrEqual(2000);
    expect(msgs.filter((m) => m.content.includes(url))).toHaveLength(1);
  });

  it("does not cut a URL with no spaces around it", () => {
    const url = "https://example.com/" + "p".repeat(60);
    const text = "a".repeat(1980) + url + "b".repeat(100);
    const msgs = buildDiscordMessages(mirror({ text }));
    expect(msgs.filter((m) => m.content.includes(url))).toHaveLength(1);
  });

  it("puts files only on the first message", () => {
    const msgs = buildDiscordMessages(
      mirror({
        text: "x ".repeat(2000),
        images: [
          { url: "https://i.example/1.png", alt: "one", mimeType: "image/png" },
        ],
        video: {
          url: "https://v.example/v.mp4",
          thumbnail: "https://v.example/t.jpg",
        },
      }),
    );
    expect(msgs.length).toBeGreaterThan(1);
    expect(msgs[0]!.files).toEqual([
      {
        url: "https://i.example/1.png",
        filename: "image-1.png",
        alt: "one",
        mimeType: "image/png",
      },
    ]);
    expect(msgs[0]!.embeds).toEqual([
      { image: { url: "https://v.example/t.jpg" } },
    ]);
    for (const m of msgs.slice(1)) {
      expect(m.files).toBeUndefined();
      expect(m.embeds).toBeUndefined();
    }
  });

  it("adds View on buttons to the last message", () => {
    const msgs = buildDiscordMessages(
      mirror({
        text: "x ".repeat(2000),
        permalinks: [
          { service: "twitter", url: "https://x.com/1" },
          { service: "linkedin", url: "https://linkedin.com/2" },
          { service: "bluesky", url: "https://bsky.app/3" },
          { service: "threads", url: "https://threads.net/4" },
        ],
      }),
    );
    expect(msgs[0]!.components).toBeUndefined();
    expect(msgs.at(-1)!.components).toEqual([
      {
        type: 1,
        components: [
          { type: 2, style: 5, label: "View on X", url: "https://x.com/1" },
          {
            type: 2,
            style: 5,
            label: "View on LinkedIn",
            url: "https://linkedin.com/2",
          },
          {
            type: 2,
            style: 5,
            label: "View on Bluesky",
            url: "https://bsky.app/3",
          },
        ],
      },
    ]);
  });

  it("joins thread texts and appends the link url when missing", () => {
    const msgs = buildDiscordMessages(
      mirror({
        text: "one",
        threadTexts: ["two"],
        link: {
          url: "https://l.example/x",
          title: "",
          text: "",
          thumbnail: null,
        },
      }),
    );
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.content).toBe("one\n\ntwo\n\nhttps://l.example/x");
    expect(msgs[0]!.username).toBe("Buffer");
    expect(msgs[0]!.avatar_url).toBe("https://a.example/av.png");

    const again = buildDiscordMessages(
      mirror({
        text: "see https://l.example/x",
        link: {
          url: "https://l.example/x",
          title: "",
          text: "",
          thumbnail: null,
        },
      }),
    );
    expect(again[0]!.content).toBe("see https://l.example/x");
  });
});
