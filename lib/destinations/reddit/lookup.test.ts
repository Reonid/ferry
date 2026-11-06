import { describe, expect, it, vi } from "vitest";
import { DRAFT_TTL_S } from "../../constants";
import type { RedditDraft } from "../../types";
import { redditSubmitPage } from "./draft";
import { findLiveDraft } from "./lookup";

const NOW = 1_800_000_000_000;

const draft: RedditDraft = {
  token: "Tok_123-abc",
  accountId: "a1",
  subreddit: "SideProject",
  title: "Hello",
  body: "Body",
  kind: "self",
  url: null,
  images: [],
  submitUrl:
    "https://www.reddit.com/r/SideProject/submit?type=TEXT&title=Hello&text=Body",
  createdAt: NOW - 60_000,
};

function storeWith(...drafts: RedditDraft[]) {
  return {
    getDraft: vi.fn(
      async (token: string) => drafts.find((d) => d.token === token) ?? null,
    ),
  };
}

describe("findLiveDraft", () => {
  it("finds a draft by its token", async () => {
    expect(await findLiveDraft(storeWith(draft), draft.token, NOW)).toEqual(
      draft,
    );
  });

  it("returns null for an unknown token", async () => {
    expect(await findLiveDraft(storeWith(draft), "other", NOW)).toBeNull();
  });

  it("rejects a malformed token without reading the store", async () => {
    const store = storeWith(draft);
    for (const token of ["", "../x", "a b", "a%20b", "x".repeat(65)])
      expect(await findLiveDraft(store, token, NOW)).toBeNull();
    expect(store.getDraft).not.toHaveBeenCalled();
  });

  it("treats a draft as gone once its 7 days are up", async () => {
    const store = storeWith(draft);
    const expiry = draft.createdAt + DRAFT_TTL_S * 1000;
    expect(await findLiveDraft(store, draft.token, expiry - 1)).toEqual(draft);
    expect(await findLiveDraft(store, draft.token, expiry)).toBeNull();
  });

  it("refuses a draft whose post link isn't its subreddit's submit page", async () => {
    for (const submitUrl of [
      "https://evil.example/r/SideProject/submit?title=Hello",
      "https://www.reddit.com.evil.example/r/SideProject/submit",
      "https://www.reddit.com/r/Other/submit?title=Hello",
      "https://www.reddit.com/r/SideProject/submitted",
      "http://www.reddit.com/r/SideProject/submit?title=Hello",
      "javascript:alert(1)",
    ]) {
      const bad = { ...draft, submitUrl };
      expect(await findLiveDraft(storeWith(bad), bad.token, NOW)).toBeNull();
    }
  });

  it("accepts the bare submit page", async () => {
    const bare = { ...draft, submitUrl: redditSubmitPage("SideProject") };
    expect(await findLiveDraft(storeWith(bare), bare.token, NOW)).toEqual(bare);
  });
});

describe("redditSubmitPage", () => {
  it("is the subreddit's submit page with nothing filled in", () => {
    expect(redditSubmitPage("SideProject")).toBe(
      "https://www.reddit.com/r/SideProject/submit",
    );
  });
});
