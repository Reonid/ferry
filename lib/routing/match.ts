import type { Post, Route } from "../types";

export function publishTime(post: Post): number | null {
  const iso = post.sentAt ?? post.dueAt;
  if (iso === null) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Whether a running route takes this post: one of its channels, published
 * once the route was active, and tagged as the route asks. The post's
 * status is the caller's concern.
 */
export function routeCoversPost(post: Post, route: Route): boolean {
  const at = publishTime(post);
  if (at === null || route.paused) return false;
  return (
    route.channelIds.includes(post.channelId) &&
    at >= route.activeSince &&
    routeTakesTags(post, route)
  );
}

/** Whether a route's tag filter lets a post through: no tags take every post. */
export function routeTakesTags(post: Post, route: Route): boolean {
  if (route.tagNames.length === 0) return true;
  const tags = new Set(post.tags.map((t) => t.name.toLowerCase()));
  return route.tagNames.some((n) => tags.has(n.toLowerCase()));
}

export function routesForPost(post: Post, routes: Route[]): Route[] {
  if (post.status !== "sent") return [];
  return routes.filter((r) => routeCoversPost(post, r));
}
