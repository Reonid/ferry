import type { NextConfig } from "next";

// Keep `logging.fetches` off. Telegram Bot API URLs contain the bot token,
// and the dev fetch logger would print them: whole with `fullUrl`, and
// otherwise the start of the path, with the bot id and part of the secret.
const nextConfig: NextConfig = {};

export default nextConfig;
