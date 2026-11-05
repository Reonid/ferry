import type { Post, Route } from "../types";

export function publishTime(post: Post): number | null {
  const iso = post.sentAt ?? post.dueAt;
  if (iso === null) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

export function routesForPost(post: Post, routes: Route[]): Route[] {
  if (post.status !== "sent") return [];
  const at = publishTime(post);
  if (at === null) return [];
  const tags = new Set(post.tags.map((t) => t.name.toLowerCase()));
  return routes.filter(
    (r) =>
      !r.paused &&
      r.channelIds.includes(post.channelId) &&
      at >= r.activeSince &&
      (r.tagNames.length === 0 ||
        r.tagNames.some((n) => tags.has(n.toLowerCase()))),
  );
}
