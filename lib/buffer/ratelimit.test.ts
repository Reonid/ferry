import { describe, expect, it } from "vitest";
import { parseRateLimit } from "./ratelimit";

describe("parseRateLimit", () => {
  it("reads quoted named windows", () => {
    expect(parseRateLimit('"15m";r=98;t=840, "24h";r=490;t=80000', 5)).toEqual({
      observedAt: 5,
      windows: [
        { name: "15m", remaining: 98, resetSeconds: 840 },
        { name: "24h", remaining: 490, resetSeconds: 80000 },
      ],
    });
  });
  it("names an unnamed window default", () => {
    expect(parseRateLimit("r=98;t=840", 1)?.windows).toEqual([
      { name: "default", remaining: 98, resetSeconds: 840 },
    ]);
  });
  it("unions limit/remaining/reset items into one window", () => {
    expect(
      parseRateLimit("limit=100, remaining=98, reset=840", 1)?.windows,
    ).toEqual([{ name: "default", remaining: 98, resetSeconds: 840 }]);
  });
  it("does not split on commas inside quotes", () => {
    expect(parseRateLimit('"a,b";r=1;t=2', 1)?.windows[0]?.name).toBe("a,b");
  });
  it("returns null for garbage and null", () => {
    expect(parseRateLimit("garbage", 1)).toBeNull();
    expect(parseRateLimit(null, 1)).toBeNull();
    expect(parseRateLimit("", 1)).toBeNull();
  });
});
