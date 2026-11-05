import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  forbidOnly: !!process.env.CI,
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
    },
  },
});
