import { describe, expect, it } from "vitest";
import { safeNext } from "./next";

describe("safeNext", () => {
  it("keeps the consent screen and its query", () => {
    expect(safeNext("/oauth/authorize")).toBe("/oauth/authorize");
    expect(safeNext("/oauth/authorize?client_id=c1.a.b&state=x%2Fy")).toBe(
      "/oauth/authorize?client_id=c1.a.b&state=x%2Fy",
    );
    // The query is data, wherever it seems to point.
    expect(safeNext("/oauth/authorize?next=//evil.example")).toBe(
      "/oauth/authorize?next=//evil.example",
    );
  });

  it("refuses everything else", () => {
    for (const value of [
      null,
      undefined,
      "",
      "/app",
      "/",
      "/oauth/authorizer",
      "/oauth/authorize/../../app",
      "//evil.example/oauth/authorize",
      "/\\evil.example/oauth/authorize",
      "https://evil.example/oauth/authorize",
      "/oauth/authorize\n",
      `/oauth/authorize?${"x".repeat(5000)}`,
      // Short as typed, but over a cookie's size once encoded.
      `/oauth/authorize?state=${"é".repeat(700)}`,
    ])
      expect(safeNext(value), String(value)).toBeNull();
  });
});
