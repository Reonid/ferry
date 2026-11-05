import { describe, expect, it } from "vitest";
import type { RedditDraft } from "../../types";
import { buildDraftNotice } from "./notice";

const draft: RedditDraft = {
  token: "t",
  accountId: "a",
  subreddit: "SideProject",
  title: "Hi *there*",
  body: "",
  kind: "self",
  url: null,
  images: [],
  submitUrl: "https://www.reddit.com/r/SideProject/submit?type=TEXT",
  createdAt: 1,
};

describe("buildDraftNotice", () => {
  it("carries both buttons and suppresses mentions", () => {
    const m = buildDraftNotice(draft, "https://ferry.app/draft/t");
    expect(m.username).toBe("Ferry");
    expect(m.content).toBe(
      "Reddit draft ready for r/SideProject: **Hi \\*there\\***",
    );
    expect(m.allowed_mentions).toEqual({ parse: [] });
    expect(m.components).toEqual([
      {
        type: 1,
        components: [
          {
            type: 2,
            style: 5,
            label: "Post to r/SideProject",
            url: draft.submitUrl,
          },
          {
            type: 2,
            style: 5,
            label: "Open draft",
            url: "https://ferry.app/draft/t",
          },
        ],
      },
    ]);
  });
});
