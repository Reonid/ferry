import { describe, expect, it } from "vitest";
import {
  firstImageSource,
  hostOf,
  summarizeOrgLimits,
  summarizeProbe,
} from "./probe";

const img = { type: "image", source: "https://img.example/secret/a.png" };
function post(over: Record<string, unknown>) {
  return {
    id: "p",
    status: "sent",
    text: "SECRET POST TEXT",
    channelId: "c1",
    channelService: "twitter",
    dueAt: "2026-11-01T10:00:00.000Z",
    sentAt: "2026-11-01T10:00:05.000Z",
    contentItemId: null,
    externalLink: null,
    tags: [],
    assets: [],
    metadata: null,
    ...over,
  };
}
const data = {
  r0: {
    edges: [
      {
        node: post({
          id: "a",
          contentItemId: "ci1",
          assets: [img],
          tags: [{ id: "t", name: "x" }],
          externalLink: "https://x.example/1",
          metadata: {
            thread: [{ text: "SECRET POST TEXT" }, { text: "two" }],
          },
        }),
      },
      {
        node: post({
          id: "b",
          contentItemId: "ci1",
          channelId: "c2",
          sentAt: "2026-11-01T09:59:58.000Z",
        }),
      },
      { node: post({ id: "c", contentItemId: "ci2", sentAt: null }) },
    ],
  },
  u0: {
    edges: [
      {
        node: {
          id: "u",
          channelId: "c1",
          dueAt: "2026-11-08T00:00:00.000Z",
          status: "scheduled",
        },
      },
    ],
  },
  c0: [],
};

describe("summarizeProbe", () => {
  const out = summarizeProbe(
    data,
    1,
    { rateLimit: '"day";r=90;t=3600', policy: '"day";q=100;w=86400' },
    1000,
  );
  it("counts fields, copies and gaps", () => {
    expect(out.counts).toEqual({ recent: 3, upcoming: 1, channels: 0 });
    expect(out.fieldsPresent).toEqual({
      assets: 1,
      tags: 1,
      metadata: 1,
      externalLink: 1,
    });
    expect(out.threadFirstItemRepeatsText).toBe(true);
    expect(out.sharedContentItemIds).toBe(1);
    expect(out.publishNowDueAt).toEqual({
      count: 2,
      minGapSeconds: -2,
      maxGapSeconds: 5,
    });
    expect(out.rateLimitHeaders.policy).toBe('"day";q=100;w=86400');
    expect(out.parsed?.observedAt).toBe(1000);
  });
  it("never leaks post text or URLs", () => {
    const json = JSON.stringify(out);
    expect(json).not.toContain("SECRET");
    expect(json).not.toContain("img.example");
  });
  it("reports null without threads or headers", () => {
    const empty = summarizeProbe(
      { r0: { edges: [{ node: post({}) }] } },
      1,
      { rateLimit: null, policy: null },
      0,
    );
    expect(empty.threadFirstItemRepeatsText).toBeNull();
    expect(empty.parsed).toBeNull();
    expect(
      summarizeProbe({}, 1, { rateLimit: null, policy: null }, 0)
        .publishNowDueAt,
    ).toEqual({ count: 0, minGapSeconds: null, maxGapSeconds: null });
  });
});

describe("probe helpers", () => {
  it("finds the first image and only exposes its host", () => {
    expect(firstImageSource(data, 1)).toBe(img.source);
    expect(firstImageSource({}, 1)).toBeNull();
    expect(hostOf(img.source)).toBe("img.example");
    expect(hostOf("nope")).toBeNull();
  });
  it("reads tag limits per organization", () => {
    expect(
      summarizeOrgLimits({
        account: { organizations: [{ id: "o1", limits: { tags: 20 } }] },
      }),
    ).toEqual([{ organizationId: "o1", tags: 20 }]);
    expect(summarizeOrgLimits(null)).toEqual([]);
  });
});
