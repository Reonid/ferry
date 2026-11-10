import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  forbidOnly: !!process.env.CI,
  // Every test signs in to the same seeded dev account in one in-memory
  // store, and some tests change it (deleting a route), so they take turns.
  // Each test re-seeds the account when it signs in.
  workers: 1,
  use: { baseURL: "http://localhost:3100" },
  // Chromium only (CI installs just that browser). Pixel 7 rather than an
  // iPhone profile because iPhone profiles run on WebKit.
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    {
      name: "mobile",
      use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 } },
    },
  ],
  webServer: {
    command: "npm run dev:e2e",
    port: 3100,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      SESSION_SECRET: "test-session-secret-0123456789-abcdefghi",
      ENCRYPTION_KEY: Buffer.alloc(32).toString("base64"),
      NEXT_PUBLIC_BASE_URL: "http://localhost:3100",
      // Set but empty, so values in .env.local never apply: browser tests
      // must use the in-memory store, never a real Redis database.
      UPSTASH_REDIS_REST_URL: "",
      UPSTASH_REDIS_REST_TOKEN: "",
      KV_REST_API_URL: "",
      KV_REST_API_TOKEN: "",
      // Fixed, so values in .env.local never apply either. Linking a chat
      // makes no Bot API call, and the tests answer /api/telegram/check
      // themselves, so this token never reaches Telegram.
      TELEGRAM_BOT_USERNAME: "FerryTestBot",
      TELEGRAM_BOT_TOKEN: "test-token",
    },
  },
});
