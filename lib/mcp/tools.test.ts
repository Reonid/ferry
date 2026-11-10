import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { seedDevAccount } from "../dev/seed";
import { createFakeRedis, createStore, type Store } from "../store";
import { handleMcpPost } from "./protocol";
import {
  FERRY_INSTRUCTIONS,
  ferryMcpServer,
  type FerryToolContext,
} from "./tools";

const BASE = "https://ferry.example";
const NOW = Date.UTC(2026, 10, 10, 12);

let store: Store;
let ctx: FerryToolContext;

beforeEach(async () => {
  store = createStore(createFakeRedis(), randomBytes(32));
  const accountId = await seedDevAccount(store, NOW);
  ctx = { store, accountId, now: NOW, baseUrl: BASE };
});

const server = ferryMcpServer(BASE);

async function run(name: string, args: Record<string, unknown> = {}) {
  const tool = server.tools.find((t) => t.definition.name === name);
  if (!tool) throw new Error(`no tool ${name}`);
  return tool.run(args, ctx);
}

async function data(name: string, args: Record<string, unknown> = {}) {
  const outcome = await run(name, args);
  if (!outcome.ok) throw new Error(outcome.message);
  return outcome.data as Record<string, unknown> & {
    [key: string]: unknown;
  };
}

describe("the tool list", () => {
  it("has three read-only tools, each declaring every hint", () => {
    expect(server.tools.map((t) => t.definition.name)).toEqual([
      "get_overview",
      "list_activity",
      "list_reddit_drafts",
    ]);
    for (const { definition } of server.tools) {
      expect(definition.annotations).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      });
      expect(definition).toMatchObject({
        title: expect.any(String),
        description: expect.any(String),
        inputSchema: { type: "object", additionalProperties: false },
        outputSchema: { type: "object" },
        securitySchemes: [{ type: "oauth2", scopes: ["ferry:read"] }],
      });
    }
  });

  it("keeps the instructions under the 512 characters ChatGPT reads", () => {
    expect(FERRY_INSTRUCTIONS.length).toBeLessThanOrEqual(512);
  });

  it("names Ferry with links back to it", () => {
    expect(server.info).toMatchObject({
      name: "ferry",
      title: "Ferry",
      websiteUrl: BASE,
    });
  });
});

describe("get_overview", () => {
  it("describes the account, its routes and what needs it", async () => {
    const overview = await data("get_overview");
    expect(overview).toMatchObject({
      account: {
        name: "Ferry Dev",
        timeZone: "Europe/Zagreb",
        buffer: "connected",
      },
      status: "live",
      dashboardUrl: `${BASE}/app`,
      bufferApiCallsToday: expect.any(Number),
    });
    expect(overview.channels).toContainEqual({
      id: "dev-bluesky",
      name: "Ferry Dev",
      network: "Bluesky",
      problems: [],
    });
    expect(overview.destinations).toContainEqual({
      id: "dev-telegram",
      name: "Ferry Updates",
      kind: "telegram",
      state: "active",
      getsAlerts: false,
      chatType: "channel",
    });
    expect(overview.destinations).toContainEqual(
      expect.objectContaining({ id: "dev-discord", getsAlerts: true }),
    );
    expect(overview.routes).toContainEqual({
      id: "dev-route",
      from: [
        { channelId: "dev-bluesky", name: "Ferry Dev", network: "Bluesky" },
        { channelId: "dev-linkedin", name: "Leon Dev", network: "LinkedIn" },
      ],
      to: {
        destinationId: "dev-discord",
        name: "#announcements",
        kind: "discord",
      },
      onlyPostsTagged: [],
      state: "running",
      since: new Date(NOW - 3 * 24 * 3_600_000).toISOString(),
    });
  });

  it("says when Buffer has signed Ferry out, and when a route is broken or paused", async () => {
    const account = await store.getAccount(ctx.accountId);
    if (!account) throw new Error("no account");
    await store.putAccount({ ...account, status: "needs_reauth" });
    const discord = await store.getDestination("dev-discord");
    if (discord?.kind !== "discord") throw new Error("no discord");
    await store.putDestination({ ...discord, status: "broken" });
    const route = await store.getRoute("dev-telegram-route");
    if (!route) throw new Error("no route");
    await store.putRoute({ ...route, paused: true });

    const overview = await data("get_overview");
    expect(overview).toMatchObject({
      status: "sign_in_needed",
      account: { buffer: "sign_in_needed" },
    });
    const states = Object.fromEntries(
      (overview.routes as { id: string; state: string }[]).map((r) => [
        r.id,
        r.state,
      ]),
    );
    expect(states).toEqual({
      "dev-route": "broken",
      "dev-telegram-route": "paused",
    });
  });

  it("names channels Buffer has trouble with, and removed ones", async () => {
    const channels = await store.getChannels(ctx.accountId);
    await store.putChannels(
      ctx.accountId,
      channels
        .filter((c) => c.id !== "dev-linkedin")
        .map((c) => ({ ...c, isQueuePaused: true, isLocked: true })),
    );
    const overview = await data("get_overview");
    expect(overview.channels).toContainEqual(
      expect.objectContaining({
        id: "dev-bluesky",
        problems: ["queue paused in Buffer", "locked in Buffer"],
      }),
    );
    const route = (overview.routes as { id: string; from: unknown[] }[]).find(
      (r) => r.id === "dev-route",
    );
    expect(route?.from).toContainEqual({
      channelId: "dev-linkedin",
      name: "Removed channel",
      network: null,
    });
  });

  it("takes no arguments", async () => {
    expect(await run("get_overview", { verbose: true })).toEqual({
      ok: false,
      message: expect.stringContaining("Unknown argument: verbose"),
    });
  });
});

describe("list_activity", () => {
  it("lists posts newest first with each delivery's status", async () => {
    const { posts } = (await data("list_activity")) as {
      posts: {
        excerpt: string;
        publishedAt: string;
        deliveries: { status: string; reason?: string }[];
      }[];
    };
    expect(posts.length).toBeGreaterThan(1);
    const times = posts.map((p) => Date.parse(p.publishedAt));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    const statuses = new Set(
      posts.flatMap((p) => p.deliveries.map((d) => d.status)),
    );
    for (const status of statuses)
      expect(["delivered", "draft_ready", "sending", "needs_you"]).toContain(
        status,
      );
  });

  it("filters by status and limits the count", async () => {
    const all = (await data("list_activity", { limit: 50 })) as {
      posts: { deliveries: { status: string }[] }[];
    };
    for (const status of ["delivered", "draft_ready", "needs_you"]) {
      const { posts } = (await data("list_activity", { status })) as {
        posts: { deliveries: { status: string }[] }[];
      };
      const expected = all.posts.filter((p) =>
        p.deliveries.some((d) => d.status === status),
      );
      expect(posts, status).toEqual(expected.slice(0, 20));
    }
    const one = (await data("list_activity", { limit: 1 })) as {
      posts: unknown[];
    };
    expect(one.posts).toHaveLength(1);
  });

  it("leaves out message and draft links, which can carry chat IDs and keys", async () => {
    await store.upsertActivity(ctx.accountId, {
      groupKey: "g-links",
      excerpt: "A post with links everywhere",
      source: { service: "bluesky", name: "Ferry Dev" },
      publishedAt: NOW,
      deliveries: [
        {
          destinationId: "dev-telegram",
          status: "delivered",
          at: NOW,
          // A chat with no username: the link holds the chat's ID.
          url: "https://t.me/c/1234567890/7",
        },
        {
          destinationId: "dev-discord",
          status: "delivered",
          at: NOW,
          url: "https://discord.com/channels/100000000000000002/100000000000000003/42",
        },
        {
          destinationId: "dev-reddit",
          status: "draft_ready",
          at: NOW,
          url: "https://ferry.example/d/abc-123",
        },
      ],
    });
    const result = await data("list_activity", { limit: 1 });
    const text = JSON.stringify(result);
    for (const leak of ["1234567890", "t.me", "discord.com", "/d/", "abc-123"])
      expect(text, leak).not.toContain(leak);
    expect(
      (result as { posts: { deliveries: unknown[] }[] }).posts[0]?.deliveries,
    ).toEqual([
      expect.objectContaining({
        destination: "Ferry Updates",
        status: "delivered",
      }),
      expect.objectContaining({
        destination: "#announcements",
        status: "delivered",
      }),
      expect.objectContaining({
        destination: "r/SideProject",
        status: "draft_ready",
      }),
    ]);
  });

  it("says why a delivery needs the owner", async () => {
    const { posts } = (await data("list_activity", {
      status: "needs_you",
    })) as { posts: { deliveries: { status: string; reason?: string }[] }[] };
    expect(posts).toHaveLength(1);
    expect(posts[0]?.deliveries).toContainEqual(
      expect.objectContaining({
        status: "needs_you",
        reason: "Discord returned HTTP 500",
      }),
    );
  });

  it("refuses bad arguments with a message the model can act on", async () => {
    for (const args of [
      { status: "failed" },
      { limit: 0 },
      { limit: 51 },
      { limit: 2.5 },
      { limit: "5" },
      { since: "yesterday" },
    ]) {
      const outcome = await run("list_activity", args);
      expect(outcome.ok, JSON.stringify(args)).toBe(false);
    }
  });
});

describe("list_reddit_drafts", () => {
  it("returns live drafts with Reddit's prefilled link", async () => {
    const { drafts } = (await data("list_reddit_drafts")) as {
      drafts: Record<string, unknown>[];
    };
    expect(drafts.length).toBeGreaterThan(0);
    for (const draft of drafts) {
      expect(draft).toMatchObject({
        subreddit: "r/SideProject",
        title: expect.any(String),
        body: expect.any(String),
        kind: expect.stringMatching(/^(text|link)$/),
        submitUrl: expect.stringMatching(
          /^https:\/\/www\.reddit\.com\/r\/SideProject\/submit/,
        ),
      });
      for (const image of draft.images as { url: string }[])
        expect(image.url).toMatch(/^https:\/\//);
    }
  });

  it("leaves out expired drafts", async () => {
    const later = { ...ctx, now: NOW + 8 * 24 * 3_600_000 };
    const tool = server.tools.find(
      (t) => t.definition.name === "list_reddit_drafts",
    );
    const outcome = await tool?.run({}, later);
    expect(outcome).toEqual({ ok: true, data: { drafts: [] } });
  });

  it("refuses a bad limit", async () => {
    expect((await run("list_reddit_drafts", { limit: 21 })).ok).toBe(false);
  });
});

describe("what never leaves Ferry", () => {
  it("keeps tokens, webhook and chat IDs and the account ID out of every tool", async () => {
    const secrets = [
      "dev-webhook-token-not-real",
      "100000000000000001",
      "-1001234567890",
      "1234567890",
      "dev-access-token",
      "dev-refresh-token",
      // The draft's link token: its page opens for anyone who has it.
      "dev-draft",
      ctx.accountId,
    ];
    for (const { definition } of server.tools) {
      const reply = await handleMcpPost(
        server,
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: definition.name, arguments: {} },
        }),
        "2025-11-25",
        ctx,
      );
      const text = JSON.stringify(reply.body);
      expect(reply.body?.result).not.toHaveProperty("isError");
      for (const secret of secrets)
        expect(text, `${definition.name} leaks ${secret}`).not.toContain(
          secret,
        );
    }
  });
});
