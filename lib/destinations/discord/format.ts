import {
  DISCORD_CONTENT_MAX,
  DISCORD_FILES_MAX,
  DISCORD_USERNAME_MAX,
} from "../../constants";
import { serviceLabel } from "../../mirror/services";
import { threadParts } from "../../mirror/thread";
import { splitText, URL_SPAN } from "../../text/split";
import type { MirrorPost } from "../../types";

export interface DiscordMessage {
  content: string;
  username: string;
  avatar_url?: string;
  allowed_mentions: { parse: [] };
  components?: unknown[];
  embeds?: { image: { url: string } }[];
  files?: { url: string; filename: string; alt: string; mimeType: string }[];
}

/** Escapes Discord markdown outside URLs, plus block markers at line starts. */
export function escapeDiscordMarkdown(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      let out = "";
      let last = 0;
      for (const m of line.matchAll(URL_SPAN)) {
        const url = trimUrlSpan(m[0]);
        out += escapeInline(line.slice(last, m.index)) + url;
        last = m.index + url.length;
      }
      out += escapeInline(line.slice(last));
      return out.replace(/^(\s*)(>>>|> |#{1,3} |-# )/, "$1\\$2");
    })
    .join("\n");
}

function escapeInline(s: string): string {
  return s.replace(/[\\*_~`|[\]]/g, "\\$&");
}

/** Drops trailing markdown and unbalanced ")" that are not part of the URL. */
function trimUrlSpan(span: string): string {
  let url = span;
  for (;;) {
    const next = url.replace(/[*_~|`]+$/, "");
    if (next !== url) {
      url = next;
      continue;
    }
    if (url.endsWith(")")) {
      const close = url.split(")").length - 1;
      const open = url.split("(").length - 1;
      if (close > open) {
        url = url.slice(0, -1);
        continue;
      }
    }
    return url;
  }
}

/** Splits on paragraphs, then sentences, then hard cuts. Keeps fitting URLs whole. */
export function splitContent(
  text: string,
  max: number = DISCORD_CONTENT_MAX,
): string[] {
  return splitText(text, max);
}

export function safeUsername(name: string): string {
  const trimmed = name.trim().slice(0, DISCORD_USERNAME_MAX).trim();
  if (!trimmed || /discord|clyde/i.test(trimmed)) return "Ferry";
  return trimmed;
}

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
};

export function buildDiscordMessages(post: MirrorPost): DiscordMessage[] {
  // A thread's later posts each get a small "2/3" line (Discord subtext),
  // so the thread doesn't read as one long post.
  let body = threadParts(post)
    .map(({ label, text }) => {
      const escaped = escapeDiscordMarkdown(text);
      return label ? `-# ${label}\n${escaped}` : escaped;
    })
    .join("\n\n");
  if (post.link && !post.text.includes(post.link.url)) {
    body = body ? `${body}\n\n${post.link.url}` : post.link.url;
  }
  const chunks = splitContent(body);
  const username = safeUsername(post.source.name);
  const buttons = post.permalinks.slice(0, 3).map((p) => ({
    type: 2,
    style: 5,
    label: `View on ${serviceLabel(p.service)}`.slice(0, 80),
    url: p.url,
  }));

  return chunks.map((content, i) => {
    const m: DiscordMessage = {
      content,
      username,
      allowed_mentions: { parse: [] },
    };
    if (post.source.avatar) m.avatar_url = post.source.avatar;
    if (i === 0) {
      if (post.images.length) {
        m.files = post.images.slice(0, DISCORD_FILES_MAX).map((img, n) => ({
          url: img.url,
          filename: `image-${n + 1}.${EXT[img.mimeType] ?? "png"}`,
          alt: img.alt,
          mimeType: img.mimeType,
        }));
      }
      if (post.video?.thumbnail) {
        m.embeds = [{ image: { url: post.video.thumbnail } }];
      }
    }
    if (i === chunks.length - 1 && buttons.length) {
      m.components = [{ type: 1, components: buttons }];
    }
    return m;
  });
}
