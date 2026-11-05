import { REDDIT_TITLE_MAX } from "../../constants";
import { serviceLabel } from "../../mirror/services";
import type { MirrorPost, RedditDraft } from "../../types";

const URL_RE = /https?:\/\/\S+/g;
const HASHTAG_RE = /(^|\s)#\w+/g;
const SUBMIT_URL_MAX = 8000;

function clean(s: string): string {
  return s
    .replace(URL_RE, " ")
    .replace(HASHTAG_RE, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function truncateTitle(title: string): string {
  if (title.length <= REDDIT_TITLE_MAX) return title;
  const head = title.slice(0, REDDIT_TITLE_MAX - 1);
  const space = head.lastIndexOf(" ");
  return `${(space > 0 ? head.slice(0, space) : head).trimEnd()}…`;
}

export function draftTitle(post: MirrorPost): string {
  const firstLine = post.text.split("\n")[0] ?? "";
  const line = clean(firstLine);
  const sentence = /^.*?[.!?](?=\s|$)/.exec(line)?.[0] ?? line;
  const title =
    sentence || post.link?.title.trim() || `New post from ${post.source.name}`;
  return truncateTitle(title);
}

function stripTrailingHashtags(text: string): string {
  const lines = text.trimEnd().split("\n");
  while (lines.length && /^\s*(#\w+\s*)*$/.test(lines[lines.length - 1]!)) {
    lines.pop();
  }
  if (lines.length) {
    lines[lines.length - 1] = lines[lines.length - 1]!.replace(
      /(\s+#\w+)+\s*$/,
      "",
    );
  }
  return lines.join("\n").trimEnd();
}

export function draftBody(post: MirrorPost): string {
  const parts = [post.text, ...post.threadTexts]
    .map(stripTrailingHashtags)
    .filter(Boolean);
  const first = post.permalinks[0];
  if (first) {
    parts.push(
      `Originally posted on ${serviceLabel(first.service)}: ${first.url}`,
    );
  }
  return parts.join("\n\n");
}

export function isMainlyLink(post: MirrorPost): boolean {
  const urls = post.text.match(URL_RE) ?? [];
  if (!post.link && urls.length !== 1) return false;
  return clean(post.text).length <= 100;
}

export function redditSubmitUrl(args: {
  subreddit: string;
  kind: "self" | "link";
  title: string;
  body: string;
  url: string | null;
}): string {
  const base = `https://www.reddit.com/r/${args.subreddit}/submit`;
  const title = encodeURIComponent(args.title);
  if (args.kind === "link") {
    return `${base}?type=LINK&title=${title}&url=${encodeURIComponent(args.url ?? "")}`;
  }
  const full = `${base}?type=TEXT&title=${title}&text=${encodeURIComponent(args.body)}`;
  return full.length > SUBMIT_URL_MAX
    ? `${base}?type=TEXT&title=${title}`
    : full;
}

export function buildRedditDraft(args: {
  post: MirrorPost;
  subreddit: string;
  accountId: string;
  token: string;
  now: number;
}): RedditDraft {
  const { post, subreddit } = args;
  const title = draftTitle(post);
  const body = draftBody(post);
  const link = isMainlyLink(post);
  const kind = link ? "link" : "self";
  const url = link
    ? (post.link?.url ?? post.text.match(URL_RE)?.[0] ?? null)
    : null;
  return {
    token: args.token,
    accountId: args.accountId,
    subreddit,
    title,
    body,
    kind,
    url,
    images: post.images,
    submitUrl: redditSubmitUrl({ subreddit, kind, title, body, url }),
    createdAt: args.now,
  };
}
