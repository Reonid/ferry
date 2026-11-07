import { describe, expect, it } from "vitest";
import { account } from "../../delivery/test-support";
import type { TelegramDestination } from "../../types";
import { makeSyncDeps } from "../../sync/test-support";
import {
  checkTelegramLink,
  linkUrls,
  newLinkCode,
  processTelegramUpdates,
  startTelegramLink,
} from "./link";

const token = "123456:SECRET-token";
const telegram = { token, botUsername: "ferry_bot" };
const NOW = 1_000_000;

type Chat = {
  id: number;
  type: "private" | "group" | "supergroup" | "channel";
  title?: string;
  username?: string;
};
type Update = {
  update_id: number;
  message?: { message_id: number; chat: Chat; text?: string };
  channel_post?: { message_id: number; chat: Chat; text?: string };
};
const channelPost = (
  id: number,
  text: string,
  chat?: Partial<Chat>,
): Update => ({
  update_id: id,
  channel_post: {
    message_id: id * 10,
    chat: {
      id: -1001,
      type: "channel",
      title: "My Channel",
      username: "mych",
      ...chat,
    },
    text,
  },
});
const message = (id: number, text: string, chat: Chat): Update => ({
  update_id: id,
  message: { message_id: id * 10, chat, text },
});

/** Serves getUpdates from a queue and records every call. */
function fakeTelegram(updates: Update[], delayed = false) {
  const calls: { method: string; body: Record<string, unknown> }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const method = url.split("/").pop()!;
    const body = JSON.parse(String(init.body));
    calls.push({ method, body });
    if (method === "getUpdates") {
      if (delayed) await new Promise((r) => setTimeout(r, 5));
      const result = updates.filter((u) => u.update_id >= body.offset);
      return Response.json({ ok: true, result });
    }
    return Response.json({ ok: true, result: true });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

async function setup() {
  const { store } = makeSyncDeps();
  await store.putAccount(account());
  await store.putAccount(account({ accountId: "other" }));
  return store;
}
const run = (
  store: Awaited<ReturnType<typeof setup>>,
  fetchImpl: typeof fetch,
) => processTelegramUpdates({ store, token, now: NOW, fetchImpl });

describe("link codes", () => {
  it("makes codes and deep links", () => {
    expect(newLinkCode()).toMatch(/^FERRY-[A-HJ-NP-Z2-9]{8}$/);
    expect(linkUrls("bot", "FERRY-ABCDEFGH")).toEqual({
      channel:
        "https://t.me/bot?startchannel&admin=post_messages+delete_messages",
      group: "https://t.me/bot?startgroup=FERRY-ABCDEFGH",
      dm: "https://t.me/bot?start=FERRY-ABCDEFGH",
    });
  });
});

describe("processTelegramUpdates", () => {
  it("a channel post with the code links that channel to the right account", async () => {
    const store = await setup();
    const { code } = await startTelegramLink({
      store,
      accountId: "acct",
      purpose: "chat",
      now: NOW,
      botUsername: "b",
    });
    const tg = fakeTelegram([channelPost(1, code)]);
    await run(store, tg.fetchImpl);
    const dests = await store.listDestinations("acct");
    expect(dests).toHaveLength(1);
    expect(dests[0]).toMatchObject({
      kind: "telegram",
      chatId: "-1001",
      chatType: "channel",
      label: "My Channel",
      username: "mych",
      status: "active",
    });
    expect(await store.listDestinations("other")).toHaveLength(0);
    expect((await store.getTelegramLink(code))?.destinationId).toBe(
      dests[0]!.id,
    );
    const del = tg.calls.find((c) => c.method === "deleteMessage");
    expect(del?.body).toEqual({ chat_id: -1001, message_id: 10 });
    for (const c of tg.calls)
      if (c.method === "getUpdates")
        expect(c.body).toMatchObject({
          limit: 100,
          timeout: 0,
          allowed_updates: ["message", "channel_post"],
        });
  });

  it("a /start@bot code in a group links the group", async () => {
    const store = await setup();
    const { code } = await startTelegramLink({
      store,
      accountId: "acct",
      purpose: "chat",
      now: NOW,
      botUsername: "b",
    });
    const tg = fakeTelegram([
      message(1, `/start@ferry_bot ${code}`, {
        id: -55,
        type: "supergroup",
        title: "  Crew  ",
      }),
    ]);
    await run(store, tg.fetchImpl);
    const [d] = await store.listDestinations("acct");
    expect(d).toMatchObject({
      chatId: "-55",
      chatType: "supergroup",
      label: "Crew",
      username: null,
    });
  });

  it("a /start code in a DM links the DM and sets it as the alert target", async () => {
    const store = await setup();
    const { code } = await startTelegramLink({
      store,
      accountId: "acct",
      purpose: "dm",
      now: NOW,
      botUsername: "b",
    });
    const tg = fakeTelegram([
      message(1, `/start ${code}`, { id: 42, type: "private" }),
    ]);
    await run(store, tg.fetchImpl);
    const [d] = await store.listDestinations("acct");
    expect(d).toMatchObject({
      label: "Telegram DM",
      chatType: "private",
      chatId: "42",
      username: null,
    });
    expect((await store.getAccount("acct"))?.notifyDestinationId).toBe(d!.id);
    const sent = tg.calls.find((c) => c.method === "sendMessage");
    expect(sent?.body).toEqual({
      chat_id: 42,
      text: "Ferry is connected. Reddit drafts and alerts will arrive here.",
    });
  });

  it("a code links once", async () => {
    const store = await setup();
    const { code } = await startTelegramLink({
      store,
      accountId: "acct",
      purpose: "chat",
      now: NOW,
      botUsername: "b",
    });
    await run(store, fakeTelegram([channelPost(1, code)]).fetchImpl);
    await store.putTelegramOffset(0);
    await run(
      store,
      fakeTelegram([channelPost(2, code, { id: -2002, title: "Second" })])
        .fetchImpl,
    );
    const dests = await store.listDestinations("acct");
    expect(dests).toHaveLength(1);
    expect(dests[0]).toMatchObject({ chatId: "-1001" });
  });

  it("relinking the same chat updates the destination in place", async () => {
    const store = await setup();
    const a = await startTelegramLink({
      store,
      accountId: "acct",
      purpose: "chat",
      now: NOW,
      botUsername: "b",
    });
    await run(store, fakeTelegram([channelPost(1, a.code)]).fetchImpl);
    const [first] = await store.listDestinations("acct");
    await store.putDestination({
      ...(first as TelegramDestination),
      status: "broken",
      label: "old",
    });
    const b = await startTelegramLink({
      store,
      accountId: "acct",
      purpose: "chat",
      now: NOW + 5,
      botUsername: "b",
    });
    await run(store, fakeTelegram([channelPost(2, b.code)]).fetchImpl);
    const dests = await store.listDestinations("acct");
    expect(dests).toHaveLength(1);
    expect(dests[0]).toMatchObject({
      id: first!.id,
      createdAt: first!.createdAt,
      status: "active",
      label: "My Channel",
    });
  });

  it("ignores unknown and expired codes", async () => {
    const store = await setup();
    const tg = fakeTelegram([channelPost(1, "FERRY-ABCDEFGH")]);
    await run(store, tg.fetchImpl);
    expect(await store.listDestinations("acct")).toHaveLength(0);
    expect(tg.calls.some((c) => c.method === "deleteMessage")).toBe(false);
  });

  it("ignores a mismatched purpose and chat type, leaving the link open", async () => {
    const store = await setup();
    const { code } = await startTelegramLink({
      store,
      accountId: "acct",
      purpose: "chat",
      now: NOW,
      botUsername: "b",
    });
    await run(
      store,
      fakeTelegram([message(1, `/start ${code}`, { id: 42, type: "private" })])
        .fetchImpl,
    );
    expect(await store.listDestinations("acct")).toHaveLength(0);
    expect((await store.getTelegramLink(code))?.destinationId).toBeNull();
  });

  it("skips a code whose account is gone", async () => {
    const { store } = makeSyncDeps();
    const { code } = await startTelegramLink({
      store,
      accountId: "ghost",
      purpose: "chat",
      now: NOW,
      botUsername: "b",
    });
    await run(store, fakeTelegram([channelPost(1, code)]).fetchImpl);
    expect(await store.listDestinations("ghost")).toHaveLength(0);
  });

  it("finds a code in a caption", async () => {
    const store = await setup();
    const { code } = await startTelegramLink({
      store,
      accountId: "acct",
      purpose: "chat",
      now: NOW,
      botUsername: "b",
    });
    const u = channelPost(1, "");
    delete u.channel_post!.text;
    (u.channel_post as { caption?: string }).caption = `hi ${code}`;
    await run(store, fakeTelegram([u]).fetchImpl);
    expect(await store.listDestinations("acct")).toHaveLength(1);
  });

  it("advances the offset past processed updates", async () => {
    const store = await setup();
    await run(
      store,
      fakeTelegram([channelPost(7, "hello"), channelPost(9, "hi")]).fetchImpl,
    );
    expect(await store.getTelegramOffset()).toBe(10);
  });

  it("does not advance past a page that failed", async () => {
    const store = await setup();
    const fetchImpl = (async () =>
      Response.json(
        { ok: false, description: "Conflict" },
        { status: 409 },
      )) as unknown as typeof fetch;
    await run(store, fetchImpl);
    expect(await store.getTelegramOffset()).toBe(0);
  });

  it("processes updates once under concurrent checks", async () => {
    const store = await setup();
    const tg = fakeTelegram([channelPost(1, "x")], true);
    await Promise.all([run(store, tg.fetchImpl), run(store, tg.fetchImpl)]);
    expect(tg.calls.filter((c) => c.method === "getUpdates")).toHaveLength(1);
  });

  it("never puts the bot token in an error", async () => {
    const store = await setup();
    const { code } = await startTelegramLink({
      store,
      accountId: "acct",
      purpose: "chat",
      now: NOW,
      botUsername: "b",
    });
    const fetchImpl = (async (url: string) => {
      throw new Error(`failed ${url}`);
    }) as unknown as typeof fetch;
    await expect(run(store, fetchImpl)).resolves.toBeUndefined();
    const result = await checkTelegramLink(
      { store, now: NOW, telegram, fetchImpl },
      "acct",
      code,
    );
    expect(JSON.stringify(result)).not.toContain("SECRET");
  });
});

describe("checkTelegramLink", () => {
  const deps = (
    store: Awaited<ReturnType<typeof setup>>,
    fetchImpl: typeof fetch,
  ) => ({ store, now: NOW, telegram, fetchImpl });

  it("waits, then connects with public fields only", async () => {
    const store = await setup();
    const { code } = await startTelegramLink({
      store,
      accountId: "acct",
      purpose: "chat",
      now: NOW,
      botUsername: "b",
    });
    expect(
      await checkTelegramLink(
        deps(store, fakeTelegram([]).fetchImpl),
        "acct",
        code,
      ),
    ).toEqual({ status: "waiting" });
    const r = await checkTelegramLink(
      deps(store, fakeTelegram([channelPost(1, code)]).fetchImpl),
      "acct",
      code,
    );
    expect(r.status).toBe("connected");
    expect(r.destination).toEqual({
      id: expect.any(String),
      kind: "telegram",
      label: "My Channel",
      status: "active",
      chatType: "channel",
    });
  });

  it("another account's code reads as expired", async () => {
    const store = await setup();
    const { code } = await startTelegramLink({
      store,
      accountId: "acct",
      purpose: "chat",
      now: NOW,
      botUsername: "b",
    });
    expect(
      await checkTelegramLink(
        deps(store, fakeTelegram([channelPost(1, code)]).fetchImpl),
        "other",
        code,
      ),
    ).toEqual({ status: "expired" });
    expect(
      await checkTelegramLink(
        deps(store, fakeTelegram([]).fetchImpl),
        "acct",
        "FERRY-AAAAAAAA",
      ),
    ).toEqual({ status: "expired" });
  });

  it("a check sees a code another check linked", async () => {
    const store = await setup();
    const { code } = await startTelegramLink({
      store,
      accountId: "acct",
      purpose: "chat",
      now: NOW,
      botUsername: "b",
    });
    await run(store, fakeTelegram([channelPost(1, code)]).fetchImpl);
    const r = await checkTelegramLink(
      deps(store, fakeTelegram([]).fetchImpl),
      "acct",
      code,
    );
    expect(r.status).toBe("connected");
  });

  it("reports expired when the linked destination is gone", async () => {
    const store = await setup();
    const { code } = await startTelegramLink({
      store,
      accountId: "acct",
      purpose: "chat",
      now: NOW,
      botUsername: "b",
    });
    await run(store, fakeTelegram([channelPost(1, code)]).fetchImpl);
    const [d] = await store.listDestinations("acct");
    await store.deleteDestination("acct", d!.id);
    expect(
      (
        await checkTelegramLink(
          deps(store, fakeTelegram([]).fetchImpl),
          "acct",
          code,
        )
      ).status,
    ).toBe("expired");
  });
});
