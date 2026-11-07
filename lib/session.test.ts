import { afterEach, describe, expect, it, vi } from "vitest";
import { sessionOptions } from "./session";

afterEach(() => vi.unstubAllEnvs());

describe("sessionOptions", () => {
  it("keeps the session's seal valid as long as its cookie", () => {
    vi.stubEnv("SESSION_SECRET", "s".repeat(32));
    const options = sessionOptions();
    const days30 = 30 * 24 * 60 * 60;
    expect(options.cookieOptions?.maxAge).toBe(days30);
    expect(options.ttl).toBe(days30);
  });
});
