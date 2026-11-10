import type { NextConfig } from "next";

// Keep `logging.fetches` off. Telegram Bot API URLs contain the bot token,
// and the dev fetch logger would print them: whole with `fullUrl`, and
// otherwise the start of the path, with the bot id and part of the secret.
const nextConfig: NextConfig = {
  experimental: {
    // The landing (app/(site)) and the app (app/(app)) are two documents
    // with their own root layouts. The default merging put the app's fonts
    // and styles into a chunk the landing loads; a cheap request cost keeps
    // each route's CSS to what it imports.
    cssChunking: { type: "graph", requestCost: 2000 },
  },
};

export default nextConfig;
