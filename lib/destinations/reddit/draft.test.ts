import { describe, expect, it } from "vitest";
import type { MirrorPost } from "../../types";
import {
  buildRedditDraft,
  draftBody,
  draftTitle,
  isMainlyLink,
  redditSubmitUrl,
} from "./draft";

function post(over: Partial<MirrorPost> = {}): MirrorPost {
  return {
    groupKey: "g",
    postIds: ["p1"],
    text: "Hello",
    threadTexts: [],
    images: [],
    video: null,
    link: null,
    permalinks: [],
    source: { channelId: "c", service: "bluesky", name: "Leon", avatar: "" },
    publishedAt: 1,
    ...over,
  };
}

describe("draftTitle", () => {
  it("uses the first sentence without hashtags", () => {
    const p = post({
      text: "Shipped Ferry today! It carries Buffer posts to Discord. #buildinpublic #BufferCommit",
    });
    expect(draftTitle(p)).toBe("Shipped Ferry today!");
  });
  it("truncates long titles at a word boundary with an ellipsis", () => {
    const p = post({ text: "word ".repeat(40).trim() });
    const t = draftTitle(p);
    expect(t.length).toBeLessThanOrEqual(120);
    expect(t.endsWith("…")).toBe(true);
  });
  it("cuts long emoji titles without breaking characters", () => {
    const p = post({ text: "😀".repeat(200) });
    const t = draftTitle(p);
    expect(t.length).toBeLessThanOrEqual(120);
    expect(t.isWellFormed()).toBe(true);
    expect(() => encodeURIComponent(t)).not.toThrow();
    const d = buildRedditDraft({
      post: p,
      subreddit: "x1",
      accountId: "a",
      token: "t",
      now: 1,
    });
    expect(d.title).toBe(t);
  });
  it("falls back to the link title, then the source name", () => {
    const link = {
      url: "https://x.com",
      title: "Ferry",
      text: "",
      thumbnail: null,
    };
    expect(draftTitle(post({ text: "#tag https://x.com", link }))).toBe(
      "Ferry",
    );
    expect(draftTitle(post({ text: "#tag" }))).toBe("New post from Leon");
  });
});

describe("draftBody", () => {
  it("drops trailing hashtag lines and credits the original post", () => {
    const p = post({
      text: "Hello there\n\n#a #b",
      permalinks: [
        { service: "bluesky", url: "https://bsky.app/profile/x/post/1" },
      ],
    });
    const body = draftBody(p);
    expect(body).not.toContain("#a");
    expect(body.startsWith("Hello there")).toBe(true);
    expect(
      body.endsWith(
        "Originally posted on Bluesky: https://bsky.app/profile/x/post/1",
      ),
    ).toBe(true);
  });
  it("drops trailing inline hashtags and appends thread texts", () => {
    const p = post({ text: "Hello #a #b", threadTexts: ["Second"] });
    expect(draftBody(p)).toBe("Hello\n\nSecond");
  });
});

describe("isMainlyLink", () => {
  it("is true for a short text with one URL", () => {
    expect(
      isMainlyLink(post({ text: "New post: https://blog.example.com/p" })),
    ).toBe(true);
  });
  it("is false for long text or several URLs", () => {
    expect(
      isMainlyLink(post({ text: "a ".repeat(80) + "https://a.com" })),
    ).toBe(false);
    expect(isMainlyLink(post({ text: "https://a.com https://b.com" }))).toBe(
      false,
    );
  });
  it("is true for a link card with short text", () => {
    const link = {
      url: "https://x.com",
      title: "T",
      text: "",
      thumbnail: null,
    };
    expect(isMainlyLink(post({ text: "Read this", link }))).toBe(true);
  });
});

describe("redditSubmitUrl", () => {
  it("builds a self post URL", () => {
    expect(
      redditSubmitUrl({
        subreddit: "SideProject",
        kind: "self",
        title: "Hello world",
        body: "Body",
        url: null,
      }),
    ).toBe(
      "https://www.reddit.com/r/SideProject/submit?type=TEXT&title=Hello%20world&text=Body",
    );
  });
  it("builds a link post URL", () => {
    expect(
      redditSubmitUrl({
        subreddit: "x1",
        kind: "link",
        title: "T",
        body: "B",
        url: "https://a.com/?q=1",
      }),
    ).toBe(
      "https://www.reddit.com/r/x1/submit?type=LINK&title=T&url=https%3A%2F%2Fa.com%2F%3Fq%3D1",
    );
  });
  it("drops the text when the URL is too long", () => {
    const u = redditSubmitUrl({
      subreddit: "x1",
      kind: "self",
      title: "T",
      body: "b".repeat(9000),
      url: null,
    });
    expect(u).toBe("https://www.reddit.com/r/x1/submit?type=TEXT&title=T");
  });
});

describe("buildRedditDraft", () => {
  it("builds a link draft from a link card", () => {
    const link = {
      url: "https://x.com/p",
      title: "T",
      text: "",
      thumbnail: null,
    };
    const d = buildRedditDraft({
      post: post({ text: "Read this", link }),
      subreddit: "x1",
      accountId: "a",
      token: "tok",
      now: 5,
    });
    expect(d.kind).toBe("link");
    expect(d.url).toBe("https://x.com/p");
    expect(d.createdAt).toBe(5);
    expect(d.token).toBe("tok");
    expect(d.submitUrl).toContain("type=LINK");
  });
  it("builds a self draft with images", () => {
    const images = [
      { url: "https://i.com/1.png", alt: "", mimeType: "image/png" },
    ];
    const d = buildRedditDraft({
      post: post({ text: "A long enough thought. ".repeat(10), images }),
      subreddit: "x1",
      accountId: "a",
      token: "tok",
      now: 5,
    });
    expect(d.kind).toBe("self");
    expect(d.url).toBeNull();
    expect(d.images).toEqual(images);
    expect(d.submitUrl).toContain("type=TEXT");
  });
});
