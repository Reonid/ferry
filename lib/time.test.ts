import { describe, expect, it } from "vitest";
import { dayKey } from "./time";

describe("dayKey", () => {
  it("formats the UTC day", () => {
    expect(dayKey(Date.UTC(2026, 10, 5, 23, 59))).toBe("2026-11-05");
  });
});
