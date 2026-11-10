import { describe, expect, it } from "vitest";
import { normalizeSubreddit } from "./subreddit";

describe("normalizeSubreddit", () => {
  it("accepts the common forms", () => {
    expect(normalizeSubreddit("SideProject")).toBe("SideProject");
    expect(normalizeSubreddit("r/SideProject")).toBe("SideProject");
    expect(normalizeSubreddit("/r/SideProject/")).toBe("SideProject");
    expect(normalizeSubreddit("https://www.reddit.com/r/SideProject/")).toBe(
      "SideProject",
    );
    expect(normalizeSubreddit("https://reddit.com/r/SideProject/new")).toBe(
      "SideProject",
    );
  });
  it("turns user profiles into u_ names", () => {
    expect(normalizeSubreddit("u/leon")).toBe("u_leon");
    expect(normalizeSubreddit("https://www.reddit.com/user/leon/")).toBe(
      "u_leon",
    );
  });
  it("rejects invalid input", () => {
    expect(normalizeSubreddit("bad name!")).toBeNull();
    expect(normalizeSubreddit("")).toBeNull();
    expect(normalizeSubreddit("a")).toBeNull();
  });
});
