import type { RedditDraft } from "../../types";
import type { TelegramCall } from "./format";

type Button = { text: string; url: string };

export function buildTelegramDraftNotice(
  draft: RedditDraft,
  draftPageUrl: string,
): TelegramCall {
  const sub = draft.subreddit;
  return {
    method: "sendMessage",
    params: {
      text: `Reddit draft ready for r/${sub}: ${draft.title}`,
      reply_markup: {
        inline_keyboard: [
          [
            { text: `Post to r/${sub}`, url: `${draftPageUrl}/post` },
            { text: "Open draft", url: draftPageUrl },
          ],
        ],
      },
    },
  };
}

export function buildTelegramAlert(
  message: string,
  supportUrl: string | null,
): TelegramCall {
  return {
    method: "sendMessage",
    params: {
      text: `Ferry alert: ${message}`,
      ...(supportUrl
        ? {
            reply_markup: {
              inline_keyboard: [[{ text: "How to fix", url: supportUrl }]],
            },
          }
        : {}),
    },
  };
}

/**
 * The same call with every inline-keyboard button moved into the text as a
 * `label: url` line. Telegram refuses button URLs it deems invalid (such as
 * localhost), so a rejected notice is retried this way.
 */
export function withoutButtons(call: TelegramCall): TelegramCall {
  const { reply_markup, ...rest } = call.params;
  const rows = (reply_markup as { inline_keyboard?: Button[][] } | undefined)
    ?.inline_keyboard;
  if (!rows) return call;
  const lines = rows.flat().map((b) => `${b.text}: ${b.url}`);
  const text = typeof rest.text === "string" ? rest.text : "";
  return {
    method: call.method,
    params: { ...rest, text: [text, ...lines].filter(Boolean).join("\n") },
  };
}
