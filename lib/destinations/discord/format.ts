import {
  DISCORD_CONTENT_MAX,
  DISCORD_FILES_MAX,
  DISCORD_USERNAME_MAX,
} from "../../constants";
import { serviceLabel } from "../../mirror/services";
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

const URL_SPAN = /https?:\/\/\S+/g;

/** Escapes Discord markdown outside URLs, plus block markers at line starts. */
export function escapeDiscordMarkdown(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      let out = "";
      let last = 0;
      for (const m of line.matchAll(URL_SPAN)) {
        out += escapeInline(line.slice(last, m.index)) + m[0];
        last = m.index + m[0].length;
      }
      out += escapeInline(line.slice(last));
      return out.replace(/^(\s*)(>>>|> |#{1,3} |-# )/, "$1\\$2");
    })
    .join("\n");
}

function escapeInline(s: string): string {
  return s.replace(/[\\*_~`|]/g, "\\$&");
}

function packParts(parts: string[], sep: string, max: number): string[] {
  const out: string[] = [];
  let cur = "";
  for (const p of parts) {
    if (!p) continue;
    if (p.length > max) {
      if (cur) out.push(cur);
      cur = "";
      out.push(...hardCut(p, max));
    } else if (!cur) cur = p;
    else if (cur.length + sep.length + p.length <= max) cur += sep + p;
    else {
      out.push(cur);
      cur = p;
    }
  }
  if (cur) out.push(cur);
  return out;
}

function hardCut(text: string, max: number): string[] {
  const out: string[] = [];
  let rest = text;
  while (rest.length > max) {
    let cut = -1;
    for (let i = max; i > 0; i--) {
      if (/\s/.test(rest[i] ?? "")) {
        cut = i;
        break;
      }
    }
    if (cut <= 0) {
      cut = max;
      for (const m of rest.matchAll(URL_SPAN)) {
        const end = m.index + m[0].length;
        if (m.index < cut && end > cut && m[0].length <= max && m.index > 0) {
          cut = m.index;
        }
      }
    }
    out.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest) out.push(rest);
  return out;
}

/** Splits on paragraphs, then sentences, then hard cuts. Keeps fitting URLs whole. */
export function splitContent(
  text: string,
  max: number = DISCORD_CONTENT_MAX,
): string[] {
  if (text.length <= max) return [text];
  const paragraphs = text.split(/\n{2,}/);
  const out: string[] = [];
  let cur = "";
  const flush = () => {
    if (cur) out.push(cur);
    cur = "";
  };
  for (const para of paragraphs) {
    if (para.length > max) {
      flush();
      const sentences = para.split(/(?<=[.!?])\s+/);
      out.push(...packParts(sentences, " ", max));
    } else if (!cur) cur = para;
    else if (cur.length + 2 + para.length <= max) cur += "\n\n" + para;
    else {
      flush();
      cur = para;
    }
  }
  flush();
  return out;
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
  let body = [post.text, ...post.threadTexts].filter(Boolean).join("\n\n");
  body = escapeDiscordMarkdown(body);
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
