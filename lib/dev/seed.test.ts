import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createFakeRedis, createStore } from "@/lib/store";
import { seedDevAccount } from "./seed";

describe("seedDevAccount", () => {
  it("seeds a usable dev account", async () => {
    const store = createStore(createFakeRedis(), randomBytes(32));
    const now = 1_800_000_000_000;
    const id = await seedDevAccount(store, now);
    expect(id).toBe("dev-account");

    expect((await store.getAccount(id))?.status).toBe("active");
    const tokens = await store.getTokens(id);
    expect(tokens && tokens.expiresAt > now).toBe(true);
    const channels = await store.getChannels(id);
    expect(channels.map((c) => [c.service, c.name])).toEqual([
      ["bluesky", "Ferry Dev"],
      ["linkedin", "Leon Dev"],
    ]);
    const dests = await store.listDestinations(id);
    expect(dests.map((d) => d.kind).sort()).toEqual([
      "discord",
      "reddit",
      "telegram",
    ]);
    const telegram = dests.find((d) => d.kind === "telegram");
    expect(telegram).toMatchObject({
      label: "Ferry Updates",
      chatId: "-1001234567890",
      chatType: "channel",
      username: "ferryupdates",
      status: "active",
    });
    const routes = await store.listRoutes(id);
    expect(routes.map((r) => r.destinationId).sort()).toEqual([
      "dev-discord",
      telegram?.id,
    ]);
    expect((await store.getDraft("dev-draft"))?.accountId).toBe(id);
    expect((await store.listAlerts(id, 10)).length).toBe(1);

    const activity = await store.listActivity(id, 10);
    expect(activity.length).toBe(3);
    expect(
      activity
        .flatMap((a) => a.deliveries)
        .find((d) => d.destinationId === telegram?.id),
    ).toMatchObject({
      status: "delivered",
      url: "https://t.me/ferryupdates/42",
    });
    const failed = activity
      .flatMap((a) => a.deliveries)
      .find((d) => d.status === "failed");
    expect(failed?.jobId).toBeTruthy();
    const job = await store.getRetry(failed?.jobId ?? "");
    expect(job?.failed).toBe(true);
    expect(
      activity
        .flatMap((a) => a.deliveries)
        .some((d) => d.status === "delivered"),
    ).toBe(true);
  });

  it("is idempotent", async () => {
    const store = createStore(createFakeRedis(), randomBytes(32));
    await seedDevAccount(store, 1_800_000_000_000);
    await seedDevAccount(store, 1_800_000_000_000);
    expect((await store.listRoutes("dev-account")).length).toBe(2);
    expect((await store.listActivity("dev-account", 10)).length).toBe(3);
  });
});
