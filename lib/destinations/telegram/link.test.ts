import { afterEach, describe, expect, it, vi } from "vitest";
import { TELEGRAM_LINK_TTL_S } from "../../constants";
import { deliverToDestination } from "../../delivery/deliver";
import { account, makeDeps, mirror } from "../../delivery/test-support";
import type {
  DeliveryOutcome,
  Destination,
  TelegramDestination,
} from "../../types";
import { makeSyncDeps } from "../../sync/test-support";
import {
  checkTelegramLink,
  isLinkCode,
  LINK_CODE,
  linkUrls,
  newLinkCode,
  processTelegramUpdates,
  startTelegramLink,
} from "./link";

const token = "123456:SECRET-token";
/** The public part of the token, which keys the bot's update offset. */
const botId = "123456";
const telegram = { token, botUsername: "ferry_bot" };
const NOW = 1_000_000;

type Chat = {
  id: number;
  type: "private" | "group" | "supergroup" | "channel";
  title?: string;
  username?: string;
};
type Message = {
  message_id: number;
  chat: Chat;
  text?: string;
  from?: { id: number };
  sender_chat?: { id: number };
};
type Update = {
  update_id: number;
  message?: Message;
  channel_post?: Message;
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
const message = (
  id: number,
  text: string,
  chat: Chat,
  sender?: Pick<Message, "from" | "sender_chat">,
): Update => ({
  update_id: id,
  message: { message_id: id * 10, chat, text, ...sender },
});
/** The user the fake Telegram lists as every group's admin. */
const ADMIN = { id: 7 };

/**
 * Serves getUpdates from a queue and records every call. getChatAdministrators
 * lists ADMIN, as the group's creator.
 */
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
    if (method === "getChatAdministrators")
      return Response.json({
        ok: true,
        result: [{ status: "creator", user: { id: ADMIN.id, is_bot: false } }],
      });
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
/** Records, and keeps out of the test output, the line a failed page logs. */
const quietLog = () => vi.spyOn(console, "error").mockImplementation(() => {});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("link codes", () => {
  it("checks a whole string is a code", () => {
    expect(isLinkCode(newLinkCode())).toBe(true);
    expect(isLinkCode("FERRY-ABCDEFGH")).toBe(true);
    for (const s of [
      "",
      "FERRY-ABCDEFG",
      "FERRY-ABCDEFGHJ",
      "FERRY-ABCDEFG1",
      "ferry-ABCDEFGH",
      " FERRY-ABCDEFGH",
      "/start FERRY-ABCDEFGH",
    ])
      expect(isLinkCode(s), s).toBe(false);
    expect("/start FERRY-ABCDEFGH FERRY-JKLMNPQR".match(LINK_CODE)?.[0]).toBe(
      "FERRY-ABCDEFGH",
    );
  });

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

  it("a /start@bot code from a group's admin links the group", async () => {
    const store = await setup();
    const { code } = await startTelegramLink({
      store,
      accountId: "acct",
      purpose: "chat",
      now: NOW,
      botUsername: "b",
    });
    const tg = fakeTelegram([
      message(
        1,
        `/start@ferry_bot ${code}`,
        { id: -55, type: "supergroup", title: "  Crew  " },
        { from: ADMIN },
      ),
    ]);
    await run(store, tg.fetchImpl);
    const [d] = await store.listDestinations("acct");
    expect(d).toMatchObject({
      chatId: "-55",
      chatType: "supergroup",
      label: "Crew",
      username: null,
    });
    expect(
      tg.calls.find((c) => c.method === "getChatAdministrators")?.body,
    ).toEqual({ chat_id: -55 });
  });

  it("a code from a group member who isn't an admin links nothing, and stays open", async () => {
    const store = await setup();
    const { code } = await startTelegramLink({
      store,
      accountId: "acct",
      purpose: "chat",
      now: NOW,
      botUsername: "b",
    });
    const group: Chat = { id: -55, type: "group", title: "Crew" };
    const tg = fakeTelegram([
      message(1, `/start@ferry_bot ${code}`, group, { from: { id: 8 } }),
      // A message with no sender at all is no admin's either.
      message(2, code, group),
    ]);
    await run(store, tg.fetchImpl);
    expect(await store.listDestinations("acct")).toHaveLength(0);
    expect((await store.getTelegramLink(code))?.destinationId).toBeNull();
    expect(tg.calls.some((c) => c.method === "deleteMessage")).toBe(false);
    // The group's own admin can still use it.
    await run(
      store,
      fakeTelegram([message(3, code, group, { from: ADMIN })]).fetchImpl,
    );
    expect(await store.listDestinations("acct")).toHaveLength(1);
  });

  it("an anonymous admin, posting as the group, links it without a member check", async () => {
    const store = await setup();
    const { code } = await startTelegramLink({
      store,
      accountId: "acct",
      purpose: "chat",
      now: NOW,
      botUsername: "b",
    });
    const tg = fakeTelegram([
      message(
        1,
        code,
        { id: -55, type: "supergroup", title: "Crew" },
        { from: { id: 1087968824 }, sender_chat: { id: -55 } },
      ),
    ]);
    await run(store, tg.fetchImpl);
    expect(await store.listDestinations("acct")).toHaveLength(1);
    expect(tg.calls.some((c) => c.method === "getChatAdministrators")).toBe(
      false,
    );
  });

  it("a code sent as another chat, such as a member's own channel, links nothing", async () => {
    const store = await setup();
    const { code } = await startTelegramLink({
      store,
      accountId: "acct",
      purpose: "chat",
      now: NOW,
      botUsername: "b",
    });
    // Telegram's stand-in sender is ADMIN here, to show it isn't trusted.
    const tg = fakeTelegram([
      message(
        1,
        code,
        { id: -55, type: "supergroup" },
        { from: ADMIN, sender_chat: { id: -1009 } },
      ),
    ]);
    await run(store, tg.fetchImpl);
    expect(await store.listDestinations("acct")).toHaveLength(0);
    expect((await store.getTelegramLink(code))?.destinationId).toBeNull();
  });

  it("refuses a group code when Telegram can't confirm the sender is an admin", async () => {
    const store = await setup();
    const { code } = await startTelegramLink({
      store,
      accountId: "acct",
      purpose: "chat",
      now: NOW,
      botUsername: "b",
    });
    const tg = fakeTelegram([
      message(1, code, { id: -55, type: "group" }, { from: ADMIN }),
    ]);
    const failing = (async (url: string, init: RequestInit) =>
      url.endsWith("/getChatAdministrators")
        ? Response.json(
            { ok: false, description: "Bad Request: chat not found" },
            { status: 400 },
          )
        : tg.fetchImpl(url, init)) as unknown as typeof fetch;
    await run(store, failing);
    expect(await store.listDestinations("acct")).toHaveLength(0);
    expect((await store.getTelegramLink(code))?.destinationId).toBeNull();
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

  it("names the bot, so the code can be sent to it by hand", async () => {
    const store = await setup();
    const started = await startTelegramLink({
      store,
      accountId: "acct",
      purpose: "dm",
      now: NOW,
      botUsername: "ferry_bot",
    });
    expect(started.bot).toBe("@ferry_bot");
  });

  it("a code sent by hand in a DM, after a bare /start, links the DM", async () => {
    const store = await setup();
    const { code } = await startTelegramLink({
      store,
      accountId: "acct",
      purpose: "dm",
      now: NOW,
      botUsername: "b",
    });
    const tg = fakeTelegram([
      message(1, "/start", { id: 42, type: "private" }),
      message(2, code, { id: 42, type: "private" }),
    ]);
    await run(store, tg.fetchImpl);
    const [d] = await store.listDestinations("acct");
    expect(d).toMatchObject({ chatType: "private", chatId: "42" });
    expect((await store.getAccount("acct"))?.notifyDestinationId).toBe(d!.id);
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
    await store.putTelegramOffset(botId, 0);
    await run(
      store,
      fakeTelegram([channelPost(2, code, { id: -2002, title: "Second" })])
        .fetchImpl,
    );
    const dests = await store.listDestinations("acct");
    expect(dests).toHaveLength(1);
    expect(dests[0]).toMatchObject({ chatId: "-1001" });
  });

  it("keeps a used code, and its claim, only until 15 minutes after it was made", async () => {
    // The store's expiry reads Date.now(), so the test sets that clock.
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(NOW);
      const store = await setup();
      const { code } = await startTelegramLink({
        store,
        accountId: "acct",
        purpose: "chat",
        now: NOW,
        botUsername: "b",
      });
      const used = NOW + 10 * 60_000;
      vi.setSystemTime(used);
      await processTelegramUpdates({
        store,
        token,
        now: used,
        fetchImpl: fakeTelegram([channelPost(1, code)]).fetchImpl,
      });
      expect((await store.getTelegramLink(code))?.destinationId).toBeTruthy();
      vi.setSystemTime(NOW + TELEGRAM_LINK_TTL_S * 1000 - 1000);
      expect(await store.getTelegramLink(code)).not.toBeNull();
      expect(await store.claim(`tglink:${code}`, 1)).toBe(false);
      vi.setSystemTime(NOW + TELEGRAM_LINK_TTL_S * 1000);
      expect(await store.getTelegramLink(code)).toBeNull();
      expect(await store.claim(`tglink:${code}`, 1)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
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

  it("reconnecting a broken chat clears its alert, so a new break alerts again", async () => {
    const broken: DeliveryOutcome = {
      ok: false,
      retryable: false,
      reason: "Ferry can no longer post to this Telegram chat",
      destinationBroken: true,
    };
    const { deps, store } = makeDeps([], [broken, broken]);
    await store.putAccount(account());
    let updateId = 0;
    const connect = async (): Promise<Destination> => {
      const { code } = await startTelegramLink({
        store,
        accountId: "acct",
        purpose: "chat",
        now: NOW,
        botUsername: "b",
      });
      await run(store, fakeTelegram([channelPost(++updateId, code)]).fetchImpl);
      const [dest] = await store.listDestinations("acct");
      return dest!;
    };
    // Two different posts: copies with the same words cross once a day.
    const postTo = (destination: Destination, groupKey: string) =>
      deliverToDestination({
        account: account(),
        destination,
        mirror: mirror({
          groupKey,
          postIds: [groupKey],
          text: `Post ${groupKey}`,
        }),
        deps,
      });
    const alertKeys = async () =>
      (await store.listAlerts("acct", 10)).map((a) => a.key);

    const first = await connect();
    expect(await postTo(first, "g1")).toBe("failed");
    expect(await alertKeys()).toEqual([`dest-broken:${first.id}`]);

    const again = await connect();
    expect(again).toMatchObject({ id: first.id, status: "active" });
    expect(await alertKeys()).toEqual([]);

    expect(await postTo(again, "g2")).toBe("failed");
    expect(await alertKeys()).toEqual([`dest-broken:${first.id}`]);
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
    expect(await store.getTelegramOffset(botId)).toBe(10);
  });

  it("keeps an offset per bot, so another bot's token starts from 0", async () => {
    const store = await setup();
    await run(
      store,
      fakeTelegram([channelPost(7, "hello"), channelPost(9, "hi")]).fetchImpl,
    );
    const other = fakeTelegram([channelPost(3, "hello")]);
    await processTelegramUpdates({
      store,
      token: "654321:OTHER-token",
      now: NOW,
      fetchImpl: other.fetchImpl,
    });
    expect(other.calls[0]?.body.offset).toBe(0);
    expect(await store.getTelegramOffset("654321")).toBe(4);
    expect(await store.getTelegramOffset(botId)).toBe(10);
  });

  it("does not advance past a page that failed", async () => {
    quietLog();
    const store = await setup();
    const fetchImpl = (async () =>
      Response.json(
        { ok: false, description: "Conflict" },
        { status: 409 },
      )) as unknown as typeof fetch;
    await run(store, fetchImpl);
    expect(await store.getTelegramOffset(botId)).toBe(0);
  });

  it("looks up one code per message, however many it holds", async () => {
    const store = await setup();
    const { code } = await startTelegramLink({
      store,
      accountId: "acct",
      purpose: "dm",
      now: NOW,
      botUsername: "b",
    });
    // A 4096-character DM holds about 270 code-shaped strings.
    const spam = Array.from({ length: 270 }, () => newLinkCode()).join(" ");
    const reads = vi.spyOn(store, "getTelegramLink");
    await run(
      store,
      fakeTelegram([
        message(1, spam, { id: 7, type: "private" }),
        message(2, `/start ${code} ${spam}`, { id: 42, type: "private" }),
      ]).fetchImpl,
    );
    expect(reads).toHaveBeenCalledTimes(2);
    expect(reads).toHaveBeenLastCalledWith(code);
    const dests = await store.listDestinations("acct");
    expect(dests).toHaveLength(1);
    expect(dests[0]).toMatchObject({ chatId: "42", chatType: "private" });
  });

  it("leaves a code another run has claimed", async () => {
    const store = await setup();
    const { code } = await startTelegramLink({
      store,
      accountId: "acct",
      purpose: "chat",
      now: NOW,
      botUsername: "b",
    });
    await store.claim(`tglink:${code}`, TELEGRAM_LINK_TTL_S);
    const tg = fakeTelegram([channelPost(1, code)]);
    await run(store, tg.fetchImpl);
    expect(await store.listDestinations("acct")).toHaveLength(0);
    expect(tg.calls.some((c) => c.method === "deleteMessage")).toBe(false);
  });

  it("processes updates once under concurrent checks", async () => {
    const store = await setup();
    const { code } = await startTelegramLink({
      store,
      accountId: "acct",
      purpose: "chat",
      now: NOW,
      botUsername: "b",
    });
    const tg = fakeTelegram([channelPost(1, code)], true);
    const check = () =>
      checkTelegramLink(
        { store, now: NOW, telegram, fetchImpl: tg.fetchImpl },
        "acct",
        code,
      );
    const [first, lockedOut] = await Promise.all([check(), check()]);
    expect(tg.calls.filter((c) => c.method === "getUpdates")).toHaveLength(1);
    expect(await store.listDestinations("acct")).toHaveLength(1);
    expect(tg.calls.filter((c) => c.method === "deleteMessage")).toHaveLength(
      1,
    );
    expect(first.status).toBe("connected");
    // The locked-out check answered before the other run linked the code,
    // and its next check sees the chat.
    expect(lockedOut.status).toBe("waiting");
    expect((await check()).status).toBe("connected");
  });

  it("keeps a full page's offset when the next page fails", async () => {
    quietLog();
    const store = await setup();
    const { code } = await startTelegramLink({
      store,
      accountId: "acct",
      purpose: "chat",
      now: NOW,
      botUsername: "b",
    });
    const page = Array.from({ length: 100 }, (_, i) =>
      channelPost(i + 1, i === 49 ? code : `post ${i + 1}`),
    );
    const offsets: unknown[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      if (!url.endsWith("/getUpdates"))
        return Response.json({ ok: true, result: true });
      offsets.push(JSON.parse(String(init.body)).offset);
      return offsets.length === 1
        ? Response.json({ ok: true, result: page })
        : Response.json(
            { ok: false, error_code: 502, description: "Bad Gateway" },
            { status: 502 },
          );
    }) as unknown as typeof fetch;
    const writes = vi.spyOn(store, "putTelegramOffset");
    await run(store, fetchImpl);
    expect(offsets).toEqual([0, 101]);
    expect(await store.listDestinations("acct")).toHaveLength(1);
    expect(writes).toHaveBeenCalledTimes(1);
    expect(await store.getTelegramOffset(botId)).toBe(101);
  });

  it("logs a failed page's status, never the token", async () => {
    const log = quietLog();
    const store = await setup();
    const unauthorized = (async () =>
      Response.json(
        { ok: false, error_code: 401, description: "Unauthorized" },
        { status: 401 },
      )) as unknown as typeof fetch;
    await run(store, unauthorized);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(
      "ferry: Telegram getUpdates failed (HTTP 401: Unauthorized)",
    );
    expect(String(log.mock.calls[0])).not.toContain(token);
    expect(String(log.mock.calls[0])).not.toContain("SECRET");

    // A failed clean-up after linking stays silent.
    log.mockClear();
    const { code } = await startTelegramLink({
      store,
      accountId: "acct",
      purpose: "chat",
      now: NOW,
      botUsername: "b",
    });
    const cannotDelete = (async (url: string) =>
      url.endsWith("/getUpdates")
        ? Response.json({ ok: true, result: [channelPost(1, code)] })
        : Response.json(
            { ok: false, error_code: 400, description: "Bad Request" },
            { status: 400 },
          )) as unknown as typeof fetch;
    await run(store, cannotDelete);
    expect(await store.listDestinations("acct")).toHaveLength(1);
    expect(log).not.toHaveBeenCalled();
  });

  it("never puts the bot token in an error", async () => {
    quietLog();
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
