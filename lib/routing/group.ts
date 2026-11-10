import { createHash } from "node:crypto";
import type { Post } from "../types";
import { publishTime } from "./match";

export function fingerprint(post: Post): string {
  const text = post.text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  const first = post.assets[0]?.source ?? "";
  return createHash("sha256").update(`${text}\n${first}`).digest("hex");
}

export function groupKeyFor(post: Post): string {
  return post.contentItemId
    ? `ci:${post.contentItemId}`
    : `fp:${fingerprint(post)}`;
}

export function groupPosts(posts: Post[]): Post[][] {
  const dated = posts
    .map((post) => ({ post, at: publishTime(post) }))
    .filter((x): x is { post: Post; at: number } => x.at !== null)
    .sort((a, b) => a.at - b.at);
  const groups = new Map<string, Post[]>();
  for (const { post } of dated) {
    const key = groupKeyFor(post);
    const list = groups.get(key);
    if (list) list.push(post);
    else groups.set(key, [post]);
  }
  return [...groups.values()];
}
