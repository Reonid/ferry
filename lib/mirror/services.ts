import type { Service } from "../types";

const LABELS: Record<Service, string> = {
  twitter: "X",
  linkedin: "LinkedIn",
  bluesky: "Bluesky",
  threads: "Threads",
  mastodon: "Mastodon",
  facebook: "Facebook",
  instagram: "Instagram",
  tiktok: "TikTok",
  youtube: "YouTube",
  pinterest: "Pinterest",
  googlebusiness: "Google Business",
  substack: "Substack",
  startPage: "Start Page",
  whatsapp: "WhatsApp",
};

export function serviceLabel(service: Service): string {
  return LABELS[service];
}
