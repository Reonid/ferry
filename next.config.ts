import type { NextConfig } from "next";

// Keep `logging.fetches` off. Telegram Bot API URLs contain the bot token,
// and the dev fetch logger would print them: whole with `fullUrl`, and
// otherwise the start of the path, with the bot id and part of the secret.
const nextConfig: NextConfig = {
  // The consent screen grants access to an account, so it can't be shown
  // inside another site's frame (clickjacking), and its address, which
  // holds the request, reaches no other site in a Referer. same-origin,
  // because no-referrer would turn the form's Origin header into "null".
  async headers() {
    return [
      {
        source: "/oauth/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "Cache-Control", value: "no-store" },
        ],
      },
    ];
  },
  experimental: {
    // The landing (app/(site)) and the app (app/(app)) are two documents
    // with their own root layouts. The default merging put the app's fonts
    // and styles into a chunk the landing loads; a cheap request cost keeps
    // each route's CSS to what it imports.
    cssChunking: { type: "graph", requestCost: 2000 },
  },
};

export default nextConfig;
