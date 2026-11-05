import { describe, expect, it } from "vitest";
import type { Post, Route } from "../types";
import { routesForPost } from "./match";

const T = Date.UTC(2026, 10, 5, 12);

function post(over: Partial<Post> = {}): Post {
  return {
    id: "p1",
    status: "sent",
    text: "hello",
    dueAt: new Date(T).toISOString(),
    sentAt: new Date(T).toISOString(),
    channelId: "c1",
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

function route(over: Partial<Route> = {}): Route {
  return {
    id: "r1",
    accountId: "a1",
    channelIds: ["c1"],
    tagNames: [],
    destinationId: "d1",
    activeSince: T - 1000,
    paused: false,
    createdAt: T - 5000,
    ...over,
  };
}

describe("routesForPost", () => {
  it("matches an ordinary sent post", () => {
    expect(routesForPost(post(), [route()])).toHaveLength(1);
  });

  it("ignores posts published before activeSince", () => {
    expect(routesForPost(post(), [route({ activeSince: T + 1 })])).toEqual([]);
  });

  it("skips paused routes and other channels", () => {
    const routes = [
      route({ id: "paused", paused: true }),
      route({ id: "other", channelIds: ["c2"] }),
      route({ id: "ok" }),
    ];
    expect(routesForPost(post(), routes).map((r) => r.id)).toEqual(["ok"]);
  });

  it("skips posts that are not sent", () => {
    expect(routesForPost(post({ status: "error" }), [route()])).toEqual([]);
  });

  it("matches tag names case-insensitively", () => {
    const p = post({ tags: [{ id: "t1", name: "Launch" }] });
    expect(routesForPost(p, [route({ tagNames: ["launch"] })])).toHaveLength(1);
    expect(routesForPost(p, [route({ tagNames: ["other"] })])).toEqual([]);
    expect(routesForPost(post(), [route({ tagNames: ["launch"] })])).toEqual(
      [],
    );
  });

  it("uses dueAt when sentAt is missing", () => {
    const p = post({ sentAt: null, dueAt: new Date(T - 2000).toISOString() });
    expect(routesForPost(p, [route()])).toEqual([]);
    const q = post({ sentAt: null, dueAt: new Date(T).toISOString() });
    expect(routesForPost(q, [route()])).toHaveLength(1);
  });

  it("skips posts with no usable time", () => {
    expect(
      routesForPost(post({ sentAt: null, dueAt: null }), [route()]),
    ).toEqual([]);
  });
});
