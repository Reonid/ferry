import { TELEGRAM_POST_TIMEOUT_MS } from "../../constants";
import type { DeliveryOutcome } from "../../types";
import { telegramCall, type TelegramResult } from "./api";
import type { TelegramCall } from "./format";

type Failure = Extract<DeliveryOutcome, { ok: false }>;
type ApiFailure = Extract<TelegramResult<unknown>, { ok: false }>;

const BROKEN_400 =
  /chat not found|bot was kicked|not a member|have no rights|not enough rights|CHAT_WRITE_FORBIDDEN|need administrator rights/i;

function failureFor(res: ApiFailure, sentCount: number): Failure {
  if (res.status === 429 || res.retryAfterMs !== null) {
    return {
      ok: false,
      retryable: true,
      reason: "Telegram rate limit",
      ...(res.retryAfterMs !== null ? { retryAfterMs: res.retryAfterMs } : {}),
      sentCount,
    };
  }
  if (res.status === 400 && res.migrated) {
    return {
      ok: false,
      retryable: false,
      reason: "This Telegram group became a supergroup. Connect it again.",
      destinationBroken: true,
      sentCount,
    };
  }
  if (
    res.status === 403 ||
    (res.status === 400 && BROKEN_400.test(res.description))
  ) {
    return {
      ok: false,
      retryable: false,
      reason: "Ferry can no longer post to this Telegram chat",
      destinationBroken: true,
      sentCount,
    };
  }
  if (res.status === 0) {
    return {
      ok: false,
      retryable: true,
      reason: "Could not reach Telegram",
      sentCount,
    };
  }
  if (res.status >= 500) {
    return {
      ok: false,
      retryable: true,
      reason: `Telegram server error (HTTP ${res.status})`,
      sentCount,
    };
  }
  return {
    ok: false,
    retryable: false,
    reason: `Telegram rejected the message: ${res.description}`,
    sentCount,
  };
}

/** The text message that replaces a media call Telegram could not fetch. */
function fallbackCall(call: TelegramCall): TelegramCall {
  let caption = "";
  let urls: string[] = [];
  if (call.method === "sendMediaGroup") {
    const items = (call.params.media ?? []) as {
      media: string;
      caption?: string;
    }[];
    caption = items[0]?.caption ?? "";
    urls = items.map((m) => m.media);
  } else {
    caption =
      typeof call.params.caption === "string" ? call.params.caption : "";
    const url = call.params.photo ?? call.params.video;
    urls = typeof url === "string" ? [url] : [];
  }
  const text = [caption, urls.join("\n")].filter(Boolean).join("\n\n");
  return {
    method: "sendMessage",
    params: {
      text,
      ...(call.params.reply_markup
        ? { reply_markup: call.params.reply_markup }
        : {}),
    },
  };
}

function firstMessageId(result: unknown): number | null {
  const m = Array.isArray(result) ? result[0] : result;
  const id = (m as { message_id?: unknown } | null | undefined)?.message_id;
  return typeof id === "number" ? id : null;
}

function messageUrl(
  chatId: string,
  username: string | null,
  id: number,
): string | undefined {
  if (username) return `https://t.me/${username}/${id}`;
  if (chatId.startsWith("-100")) {
    return `https://t.me/c/${chatId.slice(4)}/${id}`;
  }
  return undefined;
}

/**
 * Sends calls in order starting at `startAt`. `sentCount` on failures is the
 * absolute number already delivered. The returned url points at the first
 * message this call sent. No reason ever holds the token or a Bot API URL.
 */
export async function sendTelegramMessages(args: {
  token: string;
  chatId: string;
  username: string | null;
  calls: TelegramCall[];
  startAt?: number;
  fetchImpl?: typeof fetch;
}): Promise<DeliveryOutcome> {
  const send = (call: TelegramCall) =>
    telegramCall<unknown>({
      token: args.token,
      method: call.method,
      params: { chat_id: args.chatId, ...call.params },
      fetchImpl: args.fetchImpl,
      timeoutMs: TELEGRAM_POST_TIMEOUT_MS,
    });
  let url: string | undefined;

  for (let i = args.startAt ?? 0; i < args.calls.length; i++) {
    const call = args.calls[i]!;
    let res = await send(call);
    if (
      !res.ok &&
      call.method !== "sendMessage" &&
      res.status === 400 &&
      !res.migrated &&
      res.retryAfterMs === null &&
      !BROKEN_400.test(res.description)
    ) {
      res = await send(fallbackCall(call));
    }
    if (!res.ok) return failureFor(res, i);
    if (url === undefined) {
      const id = firstMessageId(res.result);
      if (id !== null) url = messageUrl(args.chatId, args.username, id);
    }
  }
  return url ? { ok: true, url } : { ok: true };
}
