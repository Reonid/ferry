import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { mirror } from "../delivery/test-support";
import { seedDevAccount } from "../dev/seed";
import { createFakeRedis, createStore, type Store } from "../store";
import { makeSyncDeps, rawPost } from "../sync/test-support";
import { handleMcpPost } from "./protocol";
import {
  FERRY_INSTRUCTIONS,
  FERRY_WRITE_INSTRUCTIONS,
  ferryMcpServer,
  type FerryToolContext,
} from "./tools";

const BASE = "https://ferry.example";
const NOW = Date.UTC(2026, 10, 10, 12);

let store: Store;
let ctx: FerryToolContext;
/** Fake Buffer, Discord and Telegram for the tools that send. */
let sync: ReturnType<typeof makeSyncDeps>;

beforeEach(async () => {
  store = createStore(createFakeRedis(), randomBytes(32));
  const accountId = await seedDevAccount(store, NOW);
  sync = makeSyncDeps();
  const deps = { ...sync.deps, store, now: () => NOW };
  ctx = { store, accountId, now: NOW, baseUrl: BASE, syncDeps: () => deps };
});

const server = ferryMcpServer(BASE);
/** A connection the owner allowed to make changes. */
const writer = ferryMcpServer(BASE, { write: true });

/** Buffer's answer to the test send's query: one sent post on dev-bluesky. */
function latestPost() {
  sync.buffer.mockResolvedValue({
    data: {
      posts: { edges: [{ node: rawPost({ channelId: "dev-bluesky" }) }] },
    },
    rateLimit: null,
  });
}

async function run(name: string, args: Record<string, unknown> = {}) {
  const tool = writer.tools.find((t) => t.definition.name === name);
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
    // A read-only connection learns how the owner can allow changes.
    expect(server.instructions).toBe(FERRY_INSTRUCTIONS);
    expect(FERRY_INSTRUCTIONS).toMatch(/only reads/);
  });

  it("answers a read-only connection's call to a tool that changes things as unknown", async () => {
    const reply = await handleMcpPost(
      server,
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "pause_route", arguments: { routeId: "dev-route" } },
      }),
      "2025-11-25",
      ctx,
    );
    expect(reply.body).toMatchObject({
      error: { code: -32602, message: "Unknown tool: pause_route" },
    });
    expect((await store.getRoute("dev-route"))?.paused).toBe(false);
  });

  it("names Ferry with links back to it", () => {
    expect(server.info).toMatchObject({
      name: "ferry",
      title: "Ferry",
      websiteUrl: BASE,
    });
  });
});

describe("the tool list for a connection allowed to make changes", () => {
  it("adds five tools that change things, each one confirmed by the app", () => {
    expect(writer.tools.map((t) => t.definition.name)).toEqual([
      "get_overview",
      "list_activity",
      "list_reddit_drafts",
      "pause_route",
      "resume_route",
      "create_route",
      "retry_delivery",
      "send_latest_post",
    ]);
    const scheme = [{ type: "oauth2", scopes: ["ferry:write"] }];
    for (const { definition } of writer.tools.slice(3)) {
      expect(definition.annotations, definition.name).toMatchObject({
        readOnlyHint: false,
        destructiveHint: false,
      });
      expect(definition, definition.name).toMatchObject({
        title: expect.any(String),
        description: expect.any(String),
        inputSchema: {
          type: "object",
          required: expect.any(Array),
          additionalProperties: false,
        },
        outputSchema: { type: "object" },
        securitySchemes: scheme,
        _meta: { securitySchemes: scheme },
      });
    }
    // Only the two that send a post reach beyond Ferry.
    expect(
      writer.tools
        .filter(
          (t) =>
            (t.definition.annotations as { openWorldHint: boolean })
              .openWorldHint,
        )
        .map((t) => t.definition.name),
    ).toEqual(["retry_delivery", "send_latest_post"]);
  });

  it("tells the app to change things only when the owner asks", () => {
    expect(writer.instructions).toBe(FERRY_WRITE_INSTRUCTIONS);
    expect(FERRY_WRITE_INSTRUCTIONS.length).toBeLessThanOrEqual(512);
    expect(FERRY_WRITE_INSTRUCTIONS).toMatch(/only when the owner asks/);
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

describe("pause_route and resume_route", () => {
  it("pauses a route and says so", async () => {
    expect(
      await data("pause_route", { routeId: "dev-telegram-route" }),
    ).toMatchObject({
      route: {
        id: "dev-telegram-route",
        to: { name: "Ferry Updates", kind: "telegram" },
        state: "paused",
      },
      message: expect.stringMatching(/^Paused\./),
    });
    expect((await store.getRoute("dev-telegram-route"))?.paused).toBe(true);
    expect(
      (await data("pause_route", { routeId: "dev-telegram-route" })).message,
    ).toBe("It was already paused.");
  });

  it("resumes a route from now, leaving what was published meanwhile", async () => {
    await data("pause_route", { routeId: "dev-route" });
    expect(await data("resume_route", { routeId: "dev-route" })).toMatchObject({
      route: {
        id: "dev-route",
        state: "running",
        since: new Date(NOW).toISOString(),
      },
      message: expect.stringContaining("stay put"),
    });
    expect((await data("resume_route", { routeId: "dev-route" })).message).toBe(
      "It was already running.",
    );
  });

  it("refuses another account's route, and bad arguments", async () => {
    await store.putRoute({
      id: "their-route",
      accountId: "someone-else",
      channelIds: ["x"],
      tagNames: [],
      destinationId: "y",
      activeSince: 0,
      paused: false,
      createdAt: 0,
    });
    for (const routeId of ["their-route", "no-such-route"])
      expect(await run("pause_route", { routeId })).toEqual({
        ok: false,
        message: "That route no longer exists.",
      });
    expect((await store.getRoute("their-route"))?.paused).toBe(false);
    expect(await run("pause_route", {})).toMatchObject({ ok: false });
    expect(await run("pause_route", { routeId: 7 })).toMatchObject({
      ok: false,
    });
    expect(
      await run("resume_route", { routeId: "dev-route", paused: false }),
    ).toMatchObject({
      ok: false,
      message: expect.stringContaining("Unknown argument"),
    });
  });
});

describe("create_route", () => {
  it("adds a route and answers in get_overview's words", async () => {
    const created = await data("create_route", {
      channelIds: ["dev-linkedin"],
      destinationId: "dev-telegram",
      onlyPostsTagged: ["Launch"],
    });
    expect(created).toMatchObject({
      route: {
        from: [{ channelId: "dev-linkedin", name: "Leon Dev" }],
        to: { destinationId: "dev-telegram", name: "Ferry Updates" },
        onlyPostsTagged: ["launch"],
        state: "running",
        since: new Date(NOW).toISOString(),
      },
      message: expect.stringMatching(/^Route added\./),
    });
    const { id } = created.route as { id: string };
    const overview = await data("get_overview");
    expect((overview.routes as { id: string }[]).map((r) => r.id)).toContain(
      id,
    );
  });

  it("refuses a duplicate, a DM, and channels Ferry doesn't have", async () => {
    expect(
      await run("create_route", {
        channelIds: ["dev-linkedin", "dev-bluesky"],
        destinationId: "dev-discord",
      }),
    ).toEqual({ ok: false, message: "That route already exists." });
    await store.putDestination({
      id: "dev-dm",
      accountId: ctx.accountId,
      kind: "telegram",
      label: "Telegram DM",
      chatId: "42",
      chatType: "private",
      username: null,
      status: "active",
      createdAt: 0,
    });
    expect(
      await run("create_route", {
        channelIds: ["dev-bluesky"],
        destinationId: "dev-dm",
      }),
    ).toMatchObject({
      ok: false,
      message: expect.stringContaining("Direct messages are for alerts only"),
    });
    expect(
      await run("create_route", {
        channelIds: ["not-mine"],
        destinationId: "dev-discord",
      }),
    ).toEqual({
      ok: false,
      message: "Pick channels from your Buffer account.",
    });
    const before = (await store.listRoutes(ctx.accountId)).length;
    for (const args of [
      { channelIds: [], destinationId: "dev-discord" },
      { channelIds: "dev-bluesky", destinationId: "dev-discord" },
      { channelIds: ["dev-bluesky"] },
      {
        channelIds: ["dev-linkedin"],
        destinationId: "dev-discord",
        onlyPostsTagged: Array.from({ length: 11 }, (_, i) => `t${i}`),
      },
      { channelIds: ["dev-linkedin"], destinationId: "dev-discord", tags: [] },
    ])
      expect(
        await run("create_route", args),
        JSON.stringify(args),
      ).toMatchObject({ ok: false });
    expect(await store.listRoutes(ctx.accountId)).toHaveLength(before);
  });
});

describe("retry_delivery", () => {
  it("lists a retryId for a failed delivery, and sends it again", async () => {
    const { posts } = await data("list_activity", { status: "needs_you" });
    const [failed] = posts as {
      deliveries: { status: string; retryId?: string }[];
    }[];
    expect(
      failed?.deliveries.find((d) => d.status === "needs_you")?.retryId,
    ).toBe("dev-retry-job");
    expect(await data("retry_delivery", { retryId: "dev-retry-job" })).toEqual({
      status: "delivered",
      message: "It went through this time.",
    });
    expect(sync.calls).toHaveLength(1);
    // Retried once: it's no longer a failed delivery.
    expect(
      await run("retry_delivery", { retryId: "dev-retry-job" }),
    ).toMatchObject({ ok: false });
    expect(sync.calls).toHaveLength(1);
  });

  it("refuses another account's delivery", async () => {
    await store.putRetry(
      {
        id: "their-job",
        accountId: "someone-else",
        destinationId: "dev-discord",
        groupKey: "their-group",
        mirror: mirror(),
        attempts: 5,
        sentCount: 0,
        failed: true,
      },
      NOW + 60_000,
    );
    expect(await run("retry_delivery", { retryId: "their-job" })).toMatchObject(
      { ok: false },
    );
    expect(await run("retry_delivery", {})).toMatchObject({ ok: false });
    expect(sync.calls).toHaveLength(0);
  });
});

describe("send_latest_post", () => {
  it("sends the newest published post down a route, once every 30 seconds", async () => {
    latestPost();
    expect(await data("send_latest_post", { routeId: "dev-route" })).toEqual({
      message: "Sent your latest post.",
    });
    expect(sync.calls).toHaveLength(1);
    expect(await run("send_latest_post", { routeId: "dev-route" })).toEqual({
      ok: false,
      message: "Wait a few seconds before sending another test.",
    });
    expect(sync.calls).toHaveLength(1);
  });

  it("refuses a route that isn't there", async () => {
    expect(await run("send_latest_post", { routeId: "no-such-route" })).toEqual(
      { ok: false, message: "That route no longer exists." },
    );
    expect(sync.buffer).not.toHaveBeenCalled();
  });
});

describe("what never leaves Ferry", () => {
  const secrets = () => [
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

  it("keeps them out of what the tools that change things say", async () => {
    latestPost();
    const calls: [string, Record<string, unknown>][] = [
      ["pause_route", { routeId: "dev-route" }],
      ["resume_route", { routeId: "dev-route" }],
      [
        "create_route",
        { channelIds: ["dev-linkedin"], destinationId: "dev-telegram" },
      ],
      ["retry_delivery", { retryId: "dev-retry-job" }],
      ["send_latest_post", { routeId: "dev-telegram-route" }],
    ];
    for (const [name, args] of calls) {
      const reply = await handleMcpPost(
        writer,
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name, arguments: args },
        }),
        "2025-11-25",
        ctx,
      );
      expect(
        Array.isArray(reply.body) ? null : reply.body?.result,
        name,
      ).not.toHaveProperty("isError");
      const text = JSON.stringify(reply.body);
      for (const secret of secrets())
        expect(text, `${name} leaks ${secret}`).not.toContain(secret);
    }
  });

  it("keeps tokens, webhook and chat IDs and the account ID out of every tool", async () => {
    const secretList = secrets();
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
      expect(
        Array.isArray(reply.body) ? null : reply.body?.result,
      ).not.toHaveProperty("isError");
      for (const secret of secretList)
        expect(text, `${definition.name} leaks ${secret}`).not.toContain(
          secret,
        );
    }
  });
});
