import { describe, expect, it } from "vitest";
import type { Post } from "../types";
import { fingerprint, groupKeyFor, groupPosts } from "./group";

const T = Date.UTC(2026, 10, 5, 12);

function post(id: string, over: Partial<Post> = {}): Post {
  return {
    id,
    status: "sent",
    text: "hello",
    dueAt: null,
    sentAt: new Date(T).toISOString(),
    channelId: `c-${id}`,
    service: "twitter",
    contentItemId: null,
    externalLink: null,
    tags: [],
    error: null,
    assets: [],
    thread: [],
    link: null,
    ...over,
  };
}

const img = (source: string) => ({
  type: "image" as const,
  source,
  thumbnail: "",
  mimeType: "image/png",
  altText: "",
});

describe("groupPosts", () => {
  it("groups copies that share a contentItemId", () => {
    const groups = groupPosts([
      post("a", { contentItemId: "ci1", text: "one" }),
      post("b", { contentItemId: "ci1", text: "two" }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groupKeyFor(post("a", { contentItemId: "ci1" }))).toBe("ci:ci1");
  });

  it("groups identical text and image across channels", () => {
    const groups = groupPosts([
      post("a", { assets: [img("https://x/1.png")] }),
      post("b", { assets: [img("https://x/1.png")] }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groupKeyFor(post("a"))).toMatch(/^fp:[0-9a-f]{64}$/);
  });

  it("separates different text", () => {
    expect(
      groupPosts([post("a", { text: "one" }), post("b", { text: "two" })]),
    ).toHaveLength(2);
  });

  it("ignores case and spacing in the fingerprint", () => {
    expect(fingerprint(post("a", { text: "  Hello   World " }))).toBe(
      fingerprint(post("b", { text: "hello world" })),
    );
  });

  it("separates identical text with different images", () => {
    expect(fingerprint(post("a", { assets: [img("u1")] }))).not.toBe(
      fingerprint(post("b", { assets: [img("u2")] })),
    );
  });

  it("orders groups and members by publish time and skips undated posts", () => {
    const later = new Date(T + 1000).toISOString();
    const groups = groupPosts([
      post("late", { text: "late", sentAt: later }),
      post("none", { text: "none", sentAt: null, dueAt: null }),
      post("early2", {
        text: "early",
        sentAt: new Date(T + 500).toISOString(),
      }),
      post("early1", { text: "early" }),
    ]);
    expect(groups.map((g) => g.map((p) => p.id))).toEqual([
      ["early1", "early2"],
      ["late"],
    ]);
  });
});
