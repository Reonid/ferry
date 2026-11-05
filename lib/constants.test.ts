import { describe, expect, it } from "vitest";
import {
  HEARTBEAT_FALLBACK_MS,
  HEARTBEAT_MAX_MS,
  HEARTBEAT_MIN_MS,
  LOCK_REFRESH_MS,
  MAX_ATTEMPTS,
  RETRY_DELAYS_MS,
  TOKEN_REQUEST_TIMEOUT_MS,
} from "@/lib/constants";

describe("constants", () => {
  it("keeps the token request well inside the refresh lock", () => {
    expect(TOKEN_REQUEST_TIMEOUT_MS + 5 * 1000).toBeLessThanOrEqual(
      LOCK_REFRESH_MS,
    );
  });

  it("keeps retry delays aligned with max attempts", () => {
    expect(RETRY_DELAYS_MS).toHaveLength(MAX_ATTEMPTS - 1);
  });

  it("keeps the heartbeat clamp ordered", () => {
    expect(
      HEARTBEAT_MIN_MS < HEARTBEAT_FALLBACK_MS &&
        HEARTBEAT_FALLBACK_MS < HEARTBEAT_MAX_MS,
    ).toBe(true);
  });
});
