import { describe, expect, it } from "vitest";
import type { Asset, Channel, Post } from "../types";
import { serviceLabel } from "./services";
import { toMirrorPost } from "./to-mirror";

const T = Date.UTC(2026, 10, 5, 12);

function post(id: string, over: Partial<Post> = {}): Post {
  return {
    id,
    status: "sent",
    text: "hello",
    dueAt: null,
    sentAt: new Date(T).toISOString(),
    channelId: "c1",
    service: "twitter",
    contentItemId: "ci1",
    externalLink: null,
    tags: [],
    error: null,
    assets: [],
    thread: [],
    link: null,
    ...over,
  };
}

const image = (source: string, altText = ""): Asset => ({
  type: "image",
  source,
  thumbnail: "",
  mimeType: "image/png",
  altText,
});

const channel: Channel = {
  id: "c1",
  organizationId: "o1",
  service: "twitter",
  name: "ferry_app",
  displayName: "Ferry",
  avatar: "https://x/a.png",
  isDisconnected: false,
  isQueuePaused: false,
  isLocked: false,
};

describe("toMirrorPost", () => {
  it("carries alt text and caps images at 10", () => {
    const own = Array.from({ length: 8 }, (_, i) =>
      image(`https://x/${i}.png`, `alt ${i}`),
    );
    const p = post("a", {
      assets: own,
      thread: [
        {
          text: "t2",
          assets: [image("https://x/t1.png"), image("https://x/t2.png")],
        },
        { text: "t3", assets: [image("https://x/t3.png")] },
      ],
    });
    const m = toMirrorPost([p], [channel]);
    expect(m.images).toHaveLength(10);
    expect(m.images[0]).toEqual({
      url: "https://x/0.png",
      alt: "alt 0",
      mimeType: "image/png",
    });
    expect(m.images[8]?.url).toBe("https://x/t1.png");
    expect(m.images[9]?.url).toBe("https://x/t2.png");
    expect(m.threadTexts).toEqual(["t2", "t3"]);
    expect(m.groupKey).toBe("ci:ci1");
    expect(m.publishedAt).toBe(T);
    expect(m.source).toEqual({
      channelId: "c1",
      service: "twitter",
      name: "Ferry",
      avatar: "https://x/a.png",
    });
  });

  it("takes the first video asset", () => {
    const p = post("a", {
      assets: [
        {
          type: "video",
          source: "https://x/v.mp4",
          thumbnail: "https://x/v.jpg",
          mimeType: "video/mp4",
          altText: "",
        },
      ],
    });
    const m = toMirrorPost([p], [channel]);
    expect(m.video).toEqual({
      url: "https://x/v.mp4",
      thumbnail: "https://x/v.jpg",
    });
    expect(m.images).toEqual([]);
  });

  it("lists one permalink per copy", () => {
    const m = toMirrorPost(
      [
        post("a", { externalLink: "https://x.com/1" }),
        post("b", {
          externalLink: "https://linkedin.com/2",
          service: "linkedin",
          channelId: "c2",
        }),
        post("c", { externalLink: "https://x.com/1" }),
        post("d", { externalLink: null }),
      ],
      [channel],
    );
    expect(m.postIds).toEqual(["a", "b", "c", "d"]);
    expect(m.permalinks).toEqual([
      { service: "twitter", url: "https://x.com/1" },
      { service: "linkedin", url: "https://linkedin.com/2" },
    ]);
  });

  it("falls back to the service label for unknown channels", () => {
    const m = toMirrorPost([post("a", { service: "linkedin" })], []);
    expect(m.source).toEqual({
      channelId: "c1",
      service: "linkedin",
      name: "LinkedIn",
      avatar: "",
    });
  });

  it("uses the channel name when there is no display name", () => {
    const m = toMirrorPost([post("a")], [{ ...channel, displayName: null }]);
    expect(m.source.name).toBe("ferry_app");
  });
});

describe("serviceLabel", () => {
  it("names every service", () => {
    expect(serviceLabel("twitter")).toBe("X");
    expect(serviceLabel("googlebusiness")).toBe("Google Business");
    expect(serviceLabel("startPage")).toBe("Start Page");
    expect(serviceLabel("whatsapp")).toBe("WhatsApp");
  });
});
