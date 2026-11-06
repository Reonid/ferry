import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/dev/login/route";

// Only URLs are ever set here, never a token, so no Redis client is built.
const REDIS_URLS = ["UPSTASH_REDIS_REST_URL", "KV_REST_API_URL"];

afterEach(() => vi.unstubAllEnvs());

function devLoginEnv(over: Record<string, string> = {}): void {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("FERRY_DEV_LOGIN", "1");
  for (const name of REDIS_URLS) vi.stubEnv(name, "");
  for (const [name, value] of Object.entries(over)) vi.stubEnv(name, value);
}

describe("dev login", () => {
  it("is not found when a real Redis is configured", async () => {
    for (const name of REDIS_URLS) {
      devLoginEnv({ [name]: "https://example.upstash.io" });
      expect((await GET()).status, name).toBe(404);
    }
  });

  it("is not found outside development or without FERRY_DEV_LOGIN", async () => {
    devLoginEnv({ NODE_ENV: "production" });
    expect((await GET()).status).toBe(404);
    devLoginEnv({ FERRY_DEV_LOGIN: "" });
    expect((await GET()).status).toBe(404);
  });
});
