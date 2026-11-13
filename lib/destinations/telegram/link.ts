import { randomInt } from "node:crypto";
import { brokenDestinationAlertKey } from "../../alerts";
import {
  TELEGRAM_CHECK_LOCK_MS,
  TELEGRAM_LINK_CALL_TIMEOUT_MS,
  TELEGRAM_LINK_TTL_S,
  TELEGRAM_UPDATE_PAGES,
} from "../../constants";
import { newId } from "../../crypto";
import type { TelegramConfig } from "../../env";
import type { Store } from "../../store/store";
import type {
  PublicDestination,
  TelegramDestination,
  TelegramLink,
} from "../../types";
import { telegramCall, type TelegramResult } from "./api";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
/** Finds a link code inside a message. */
export const LINK_CODE = /FERRY-[A-HJ-NP-Z2-9]{8}/;
const EXACT_CODE = new RegExp(`^${LINK_CODE.source}$`);
const PAGE_LIMIT = 100;
const MAX_LABEL = 60;
const DM_CONFIRMATION =
  "Ferry is connected. Reddit drafts and alerts will arrive here.";

type ChatType = TelegramDestination["chatType"];
interface TelegramMessage {
  message_id: number;
  chat: { id: number; type: ChatType; title?: string; username?: string };
  /** The person who sent it. A channel post has none. */
  from?: { id: number };
  /** Set when a message is sent as a chat, as an anonymous group admin's is. */
  sender_chat?: { id: number };
  text?: string;
  caption?: string;
}
type Call = <T>(
  method: string,
  params: Record<string, unknown>,
) => Promise<TelegramResult<T>>;
interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  channel_post?: TelegramMessage;
}

export function newLinkCode(): string {
  let code = "";
  for (let i = 0; i < 8; i++) code += ALPHABET[randomInt(ALPHABET.length)];
  return `FERRY-${code}`;
}

/** True when the whole string is a link code. */
export function isLinkCode(s: string): boolean {
  return EXACT_CODE.test(s);
}

export function linkUrls(
  botUsername: string,
  code: string,
): { channel: string; group: string; dm: string } {
  return {
    channel: `https://t.me/${botUsername}?startchannel&admin=post_messages+delete_messages`,
    group: `https://t.me/${botUsername}?startgroup=${code}`,
    dm: `https://t.me/${botUsername}?start=${code}`,
  };
}

export async function startTelegramLink(args: {
  store: Store;
  accountId: string;
  purpose: "chat" | "dm";
  now: number;
  botUsername: string;
}): Promise<{
  code: string;
  /** The bot's @name, to send the code to by hand when a link can't open Telegram. */
  bot: string;
  links: ReturnType<typeof linkUrls>;
}> {
  const code = newLinkCode();
  await args.store.putTelegramLink(code, {
    accountId: args.accountId,
    purpose: args.purpose,
    createdAt: args.now,
    destinationId: null,
  });
  return {
    code,
    bot: `@${args.botUsername}`,
    links: linkUrls(args.botUsername, code),
  };
}

/** What's left of a code's 15 minutes, so using it doesn't keep it longer. */
function secondsLeft(link: TelegramLink, now: number): number {
  return Math.max(
    1,
    Math.ceil((link.createdAt + TELEGRAM_LINK_TTL_S * 1000 - now) / 1000),
  );
}

function chatLabel(title: string | undefined): string {
  const cut = Array.from(title ?? "")
    .slice(0, MAX_LABEL)
    .join("")
    .trim();
  return cut === "" ? "Telegram chat" : cut;
}

/** Creates the account's destination for this chat, or refreshes the existing one. */
async function upsertDestination(
  store: Store,
  accountId: string,
  chat: TelegramMessage["chat"],
  label: string,
  username: string | null,
  now: number,
): Promise<TelegramDestination> {
  const chatId = String(chat.id);
  const existing = (await store.listDestinations(accountId)).find(
    (d): d is TelegramDestination =>
      d.kind === "telegram" && d.chatId === chatId,
  );
  const dest: TelegramDestination = {
    id: existing?.id ?? newId(),
    accountId,
    kind: "telegram",
    label,
    chatId,
    chatType: chat.type,
    username,
    status: "active",
    createdAt: existing?.createdAt ?? now,
  };
  await store.putDestination(dest);
  // The chat takes posts again: its "Reconnect it" alert goes, and the next
  // break raises a new one.
  if (existing?.status === "broken")
    await store.clearAlertKey(
      accountId,
      brokenDestinationAlertKey(existing.id),
    );
  return dest;
}

/**
 * Whether one of a group's admins sent this message. Any member can send the
 * bot a command, but only an admin may connect the group: otherwise one member
 * could post their own Buffer posts, through Ferry's bot, into a group that
 * someone else connected. Telegram's list of admins is read each time, and a
 * failed read is a no.
 */
async function sentByGroupAdmin(
  message: TelegramMessage,
  call: Call,
): Promise<boolean> {
  // A message sent as a chat counts only when that chat is the group itself,
  // which is how an anonymous admin posts. A member posting as their own
  // channel, or a post forwarded from a linked channel, doesn't count.
  if (message.sender_chat) return message.sender_chat.id === message.chat.id;
  const { from } = message;
  if (!from) return false;
  // Unlike getChatMember, this works whether or not Ferry's bot is an admin,
  // and it lists the admins even in a group that hides its members.
  const res = await call<{ user?: { id?: unknown } }[]>(
    "getChatAdministrators",
    { chat_id: message.chat.id },
  );
  return (
    res.ok &&
    Array.isArray(res.result) &&
    res.result.some((admin) => admin.user?.id === from.id)
  );
}

async function handleCode(args: {
  store: Store;
  token: string;
  now: number;
  fetchImpl?: typeof fetch;
  code: string;
  message: TelegramMessage;
}): Promise<void> {
  const { store, token, now, fetchImpl, code, message } = args;
  const link = await store.getTelegramLink(code);
  if (!link || link.destinationId !== null) return;
  if (!(await store.getAccount(link.accountId))) return;
  const { chat } = message;
  const isChat = chat.type !== "private";
  if (link.purpose === "chat" ? !isChat : isChat) return;

  const call: Call = (method, params) =>
    telegramCall({
      token,
      method,
      params,
      fetchImpl,
      timeoutMs: TELEGRAM_LINK_CALL_TIMEOUT_MS,
    });
  // A channel needs no check: only its admins can post in it.
  const isGroup = chat.type === "group" || chat.type === "supergroup";
  if (isGroup && !(await sentByGroupAdmin(message, call))) return;
  // Keeps a code single-use even if a slow run outlives the update lock. It
  // lasts as long as the code does.
  if (!(await store.claim(`tglink:${code}`, secondsLeft(link, now)))) return;

  if (link.purpose === "chat") {
    const dest = await upsertDestination(
      store,
      link.accountId,
      chat,
      chatLabel(chat.title),
      chat.username ?? null,
      now,
    );
    await store.putTelegramLink(
      code,
      { ...link, destinationId: dest.id },
      secondsLeft(link, now),
    );
    await call("deleteMessage", {
      chat_id: chat.id,
      message_id: message.message_id,
    });
    return;
  }
  const dest = await upsertDestination(
    store,
    link.accountId,
    chat,
    "Telegram DM",
    null,
    now,
  );
  const account = await store.getAccount(link.accountId);
  if (account)
    await store.putAccount({ ...account, notifyDestinationId: dest.id });
  await store.putTelegramLink(
    code,
    { ...link, destinationId: dest.id },
    secondsLeft(link, now),
  );
  await call("sendMessage", { chat_id: chat.id, text: DM_CONFIRMATION });
}

/** Reads the bot's pending updates and links any chat that posted a live code. */
export async function processTelegramUpdates(args: {
  store: Store;
  token: string;
  now: number;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  const { store, token, now, fetchImpl } = args;
  // The public part of the token, so a new bot doesn't inherit an offset.
  const botId = token.split(":")[0]!;
  const lock = await store.acquireLock("tg-updates", TELEGRAM_CHECK_LOCK_MS);
  if (lock === null) return;
  try {
    let offset = await store.getTelegramOffset(botId);
    for (let page = 0; page < TELEGRAM_UPDATE_PAGES; page++) {
      const res = await telegramCall<TelegramUpdate[]>({
        token,
        method: "getUpdates",
        params: {
          offset,
          limit: PAGE_LIMIT,
          timeout: 0,
          allowed_updates: ["message", "channel_post"],
        },
        fetchImpl,
        timeoutMs: TELEGRAM_LINK_CALL_TIMEOUT_MS,
      });
      if (!res.ok) {
        // Only Telegram's status and description: the URL holds the token.
        // A bad token (401) or a set webhook (409) would stall every panel.
        console.error(
          `ferry: Telegram getUpdates failed (HTTP ${res.status}: ${res.description})`,
        );
        return;
      }
      if (!Array.isArray(res.result)) return;
      const updates = res.result;
      for (const update of updates) {
        const message = update.channel_post ?? update.message;
        // A link message carries one code: alone in a channel, after /start
        // in a DM or a group. Only the first is read, so a message stuffed
        // with codes costs one lookup.
        const code = (message?.text ?? message?.caption)?.match(LINK_CODE)?.[0];
        if (message && code)
          await handleCode({ store, token, now, fetchImpl, code, message });
      }
      if (updates.length > 0) {
        offset = Math.max(...updates.map((u) => u.update_id)) + 1;
        await store.putTelegramOffset(botId, offset);
      }
      if (updates.length < PAGE_LIMIT) return;
    }
  } finally {
    await store.releaseLock("tg-updates", lock);
  }
}

export async function checkTelegramLink(
  deps: {
    store: Store;
    now: number;
    telegram: TelegramConfig;
    fetchImpl?: typeof fetch;
  },
  accountId: string,
  code: string,
): Promise<{
  status: "waiting" | "connected" | "expired";
  destination?: PublicDestination;
}> {
  const { store } = deps;
  await processTelegramUpdates({
    store,
    token: deps.telegram.token,
    now: deps.now,
    fetchImpl: deps.fetchImpl,
  });
  const link: TelegramLink | null = await store.getTelegramLink(code);
  if (!link || link.accountId !== accountId) return { status: "expired" };
  if (link.destinationId === null) return { status: "waiting" };
  const dest = await store.getDestination(link.destinationId);
  if (!dest || dest.kind !== "telegram" || dest.accountId !== accountId)
    return { status: "expired" };
  return {
    status: "connected",
    destination: {
      id: dest.id,
      kind: dest.kind,
      label: dest.label,
      status: dest.status,
      chatType: dest.chatType,
    },
  };
}
