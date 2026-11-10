import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  mapAccount,
  mapChannel,
  mapPost,
  mapSyncData,
  mapUpcoming,
} from "./map";

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(`test/fixtures/posts/${name}.json`, "utf8"));
}
function firstPost(name: string) {
  const post = mapSyncData(fixture(name), 1).posts[0];
  if (!post) throw new Error(`no post mapped from ${name}`);
  return post;
}

describe("mapPost", () => {
  it("drops a thread's first item when it repeats the post text", () => {
    const post = firstPost("twitter-thread");
    expect(post.thread.map((t) => t.text)).toEqual([
      "It mirrors posts into Discord.",
      "Read-only, always.",
    ]);
    expect(post.thread[0]?.assets[0]).toEqual({
      type: "image",
      source: "https://img.example/a.png",
      thumbnail: "https://img.example/a-t.png",
      mimeType: "image/png",
      altText: "A ferry",
    });
    expect(post.tags).toEqual([{ id: "t1", name: "launch" }]);
    expect(post.service).toBe("twitter");
  });

  it("keeps a first thread item that differs from the post text", () => {
    const node = {
      id: "x",
      status: "sent",
      text: "main",
      channelId: "c",
      channelService: "mastodon",
      metadata: { thread: [{ text: "other", assets: [] }] },
    };
    expect(mapPost(node)?.thread).toHaveLength(1);
  });

  it("reads Bluesky link cards", () => {
    const post = firstPost("bluesky-link");
    expect(post.link).toEqual({
      url: "https://example.com/post",
      title: "A post",
      text: "About ferries",
      thumbnail: "https://example.com/t.png",
    });
    expect(post.thread).toEqual([]);
    expect(post.contentItemId).toBe("ci-1");
  });

  it("reads image alt text", () => {
    const post = firstPost("linkedin-images");
    expect(post.assets.map((a) => a.altText)).toEqual(["Team on stage", ""]);
    expect(post.link).toBeNull();
  });

  it("reads Buffer's error and help link", () => {
    const post = firstPost("error");
    expect(post.status).toBe("error");
    expect(post.error).toEqual({
      message: "Your Twitter connection expired",
      supportUrl: "https://support.buffer.com/reconnect",
    });
    expect(post.sentAt).toBeNull();
  });

  it("returns null for scheduled posts and incomplete nodes", () => {
    const base = { id: "x", channelId: "c", channelService: "twitter" };
    expect(mapPost({ ...base, status: "scheduled", text: "" })).toBeNull();
    expect(mapPost({ ...base, status: "sent", id: undefined })).toBeNull();
    expect(mapPost({ ...base, status: "sent", channelId: null })).toBeNull();
    expect(
      mapPost({ ...base, status: "sent", channelService: "nope" }),
    ).toBeNull();
    expect(mapPost(null)).toBeNull();
    expect(mapPost("x")).toBeNull();
  });
});

describe("mapUpcoming / mapChannel / mapAccount", () => {
  it("maps upcoming posts and rejects other statuses", () => {
    const n = { id: "u", channelId: "c", dueAt: "2026-11-06T09:00:00Z" };
    expect(mapUpcoming({ ...n, status: "scheduled" })).toEqual({
      ...n,
      status: "scheduled",
    });
    expect(mapUpcoming({ ...n, status: "sent" })).toBeNull();
    expect(mapUpcoming({ ...n, status: "sending", dueAt: null })).toBeNull();
  });
  it("rejects channels with missing fields", () => {
    expect(mapChannel({ id: "c" })).toBeNull();
  });
  it("maps an account", () => {
    expect(
      mapAccount({
        account: {
          id: "acc",
          name: null,
          timezone: "Europe/Zagreb",
          organizations: [
            { id: "o1", name: "A" },
            { id: "o2", name: "B" },
          ],
        },
      }),
    ).toEqual({
      accountId: "acc",
      name: null,
      timezone: "Europe/Zagreb",
      organizationIds: ["o1", "o2"],
    });
  });
});

describe("mapSyncData", () => {
  it("merges aliases across two organizations", () => {
    const out = mapSyncData(fixture("sync-two-orgs"), 2);
    expect(out.posts.map((p) => p.id)).toEqual(["a1", "a3", "b1"]);
    expect(out.upcoming.map((u) => u.id)).toEqual(["u1", "u2"]);
    expect(out.channels.map((c) => c.id)).toEqual([
      "ch-a",
      "ch-b",
      "ch-c",
      "ch-d",
    ]);
  });
});
