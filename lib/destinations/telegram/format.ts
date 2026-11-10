import {
  TELEGRAM_CAPTION_MAX,
  TELEGRAM_MEDIA_GROUP_MAX,
  TELEGRAM_TEXT_MAX,
} from "../../constants";
import { serviceLabel } from "../../mirror/services";
import { splitText } from "../../text/split";
import type { MirrorPost } from "../../types";

export interface TelegramCall {
  method: "sendMessage" | "sendPhoto" | "sendVideo" | "sendMediaGroup";
  params: Record<string, unknown>;
}

type Media = { type: "photo" | "video"; url: string };

/** Text goes out literally: no parse_mode, so nothing needs escaping. */
export function buildTelegramCalls(post: MirrorPost): TelegramCall[] {
  let body = [post.text, ...post.threadTexts].filter(Boolean).join("\n\n");
  if (post.link && !post.text.includes(post.link.url)) {
    body = body ? `${body}\n\n${post.link.url}` : post.link.url;
  }
  const media: Media[] = [
    ...post.images.map((i) => ({ type: "photo" as const, url: i.url })),
    ...(post.video ? [{ type: "video" as const, url: post.video.url }] : []),
  ].slice(0, TELEGRAM_MEDIA_GROUP_MAX);
  const links = post.permalinks.slice(0, 3);
  const reply_markup = links.length
    ? {
        inline_keyboard: links.map((p) => [
          { text: `View on ${serviceLabel(p.service)}`, url: p.url },
        ]),
      }
    : undefined;
  const withButtons = (c: TelegramCall): TelegramCall =>
    reply_markup ? { ...c, params: { ...c.params, reply_markup } } : c;

  const messages = (afterMedia: boolean): TelegramCall[] =>
    (body ? splitText(body, TELEGRAM_TEXT_MAX) : []).map((text) => ({
      method: "sendMessage",
      params: afterMedia
        ? { text, link_preview_options: { is_disabled: true } }
        : { text },
    }));
  const withLastButtons = (calls: TelegramCall[]): TelegramCall[] =>
    calls.map((c, i) => (i === calls.length - 1 ? withButtons(c) : c));

  if (!media.length) return withLastButtons(messages(false));

  if (media.length === 1) {
    const [item] = media as [Media];
    const key = item.type;
    const single = (caption: string | null): TelegramCall => ({
      method: item.type === "photo" ? "sendPhoto" : "sendVideo",
      params: caption ? { [key]: item.url, caption } : { [key]: item.url },
    });
    if (body.length <= TELEGRAM_CAPTION_MAX) {
      return [withButtons(single(body || null))];
    }
    return withLastButtons([single(null), ...messages(true)]);
  }

  const group = (caption: string | null): TelegramCall => ({
    method: "sendMediaGroup",
    params: {
      media: media.map((m, i) => ({
        type: m.type,
        media: m.url,
        ...(i === 0 && caption ? { caption } : {}),
      })),
    },
  });
  const lines = links
    .map((p) => `View on ${serviceLabel(p.service)}: ${p.url}`)
    .join("\n");
  const caption = [body, lines].filter(Boolean).join("\n\n");
  if (caption.length <= TELEGRAM_CAPTION_MAX) return [group(caption || null)];
  // Too long for a caption. A body of its own follows; with no body, the
  // oversized View-on lines do, so the links are never lost.
  const follow = body
    ? messages(true)
    : [
        {
          method: "sendMessage" as const,
          params: { text: lines, link_preview_options: { is_disabled: true } },
        },
      ];
  return withLastButtons([group(null), ...follow]);
}
