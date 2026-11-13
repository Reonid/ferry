import type { NextConfig } from "next";

// Keep `logging.fetches` off. Telegram Bot API URLs contain the bot token,
// and the dev fetch logger would print them: whole with `fullUrl`, and
// otherwise the start of the path, with the bot id and part of the secret.
const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      {
        // No page of Ferry's belongs in another site's frame: the consent
        // screen's Allow and the dashboard's Disconnect and Delete my data
        // could be clicked through one. Browsers also take each response as
        // the type it says it is, and other sites get at most the origin in
        // a Referer.
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
      {
        // The consent screen's address holds the request, so it reaches no
        // other site in a Referer. same-origin, because no-referrer would
        // turn the form's Origin header into "null".
        source: "/oauth/:path*",
        headers: [
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
