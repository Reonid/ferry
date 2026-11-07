import { DISCORD_FILES_MAX } from "../constants";
import { groupKeyFor } from "../routing/group";
import { publishTime } from "../routing/match";
import type { Channel, MirrorImage, MirrorPost, Post } from "../types";
import { serviceLabel } from "./services";

export function toMirrorPost(group: Post[], channels: Channel[]): MirrorPost {
  const rep = group[0];
  if (!rep) throw new Error("toMirrorPost needs at least one post");

  const images: MirrorImage[] = [
    ...rep.assets,
    ...rep.thread.flatMap((t) => t.assets),
  ]
    .filter((a) => a.type === "image")
    .slice(0, DISCORD_FILES_MAX)
    .map((a) => ({ url: a.source, alt: a.altText, mimeType: a.mimeType }));
  const video = rep.assets.find((a) => a.type === "video");

  const seen = new Set<string>();
  const permalinks: MirrorPost["permalinks"] = [];
  for (const p of group) {
    if (p.externalLink && !seen.has(p.externalLink)) {
      seen.add(p.externalLink);
      permalinks.push({ service: p.service, url: p.externalLink });
    }
  }

  const channel = channels.find((c) => c.id === rep.channelId);
  return {
    groupKey: groupKeyFor(rep),
    postIds: group.map((p) => p.id),
    text: rep.text,
    threadTexts: rep.thread.map((t) => t.text),
    images,
    video: video ? { url: video.source, thumbnail: video.thumbnail } : null,
    link: rep.link,
    permalinks,
    source: {
      channelId: rep.channelId,
      service: rep.service,
      name: channel
        ? (channel.displayName ?? channel.name)
        : serviceLabel(rep.service),
      avatar: channel?.avatar ?? "",
    },
    publishedAt: publishTime(rep) ?? 0,
  };
}
