import { describe, expect, it } from "vitest";
import {
  ACTIVITY_TTL_S,
  ALERT_DEDUPE_TTL_S,
  ALERTS_KEPT,
  CLAIM_GROUP_TTL_S,
  CLAIM_POST_TTL_S,
  DRAFT_TTL_S,
  EXCERPT_CHARS,
  HEARTBEAT_FALLBACK_MS,
  HEARTBEAT_MAX_MS,
  HEARTBEAT_MIN_MS,
  LOCK_REFRESH_MS,
  LOCK_SYNC_MS,
  MAX_ATTEMPTS,
  RETRY_DELAYS_MS,
  RETRY_JOB_TTL_S,
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

  it("keeps the retention times the privacy page states", () => {
    // app/privacy/page.tsx promises these; change the page with them.
    const DAY = 24 * 60 * 60;
    expect(CLAIM_GROUP_TTL_S).toBe(DAY);
    expect(CLAIM_POST_TTL_S).toBe(45 * DAY);
    expect(EXCERPT_CHARS).toBe(80);
    expect(ACTIVITY_TTL_S).toBe(30 * DAY);
    expect(DRAFT_TTL_S).toBe(7 * DAY);
    expect(RETRY_JOB_TTL_S).toBe(DAY);
    expect(ALERT_DEDUPE_TTL_S).toBe(7 * DAY);
    expect(ALERTS_KEPT).toBe(20);
    expect(Math.max(LOCK_SYNC_MS, LOCK_REFRESH_MS)).toBeLessThanOrEqual(60_000);
  });

  it("keeps the heartbeat clamp ordered", () => {
    expect(
      HEARTBEAT_MIN_MS < HEARTBEAT_FALLBACK_MS &&
        HEARTBEAT_FALLBACK_MS < HEARTBEAT_MAX_MS,
    ).toBe(true);
  });
});
