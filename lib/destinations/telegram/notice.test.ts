import { describe, expect, it } from "vitest";
import {
  buildTelegramAlert,
  buildTelegramDraftNotice,
  withoutButtons,
} from "./notice";
import type { RedditDraft } from "../../types";

const draft = { subreddit: "test", title: "My *title*" } as RedditDraft;

describe("buildTelegramDraftNotice", () => {
  it("is plain text with both buttons in one row", () => {
    expect(buildTelegramDraftNotice(draft, "https://ferry.test/d/t1")).toEqual({
      method: "sendMessage",
      params: {
        text: "Reddit draft ready for r/test: My *title*",
        reply_markup: {
          inline_keyboard: [
            [
              { text: "Post to r/test", url: "https://ferry.test/d/t1/post" },
              { text: "Open draft", url: "https://ferry.test/d/t1" },
            ],
          ],
        },
      },
    });
  });
});

describe("buildTelegramAlert", () => {
  it("adds a How to fix button with a support url", () => {
    expect(buildTelegramAlert("Oops", "https://s.test/x")).toEqual({
      method: "sendMessage",
      params: {
        text: "Ferry alert: Oops",
        reply_markup: {
          inline_keyboard: [[{ text: "How to fix", url: "https://s.test/x" }]],
        },
      },
    });
  });

  it("has no reply_markup without a support url", () => {
    expect(buildTelegramAlert("Oops", null).params).toEqual({
      text: "Ferry alert: Oops",
    });
  });
});

describe("withoutButtons", () => {
  it("moves each button into the text and drops reply_markup", () => {
    const call = buildTelegramDraftNotice(draft, "https://ferry.test/d/t1");
    expect(withoutButtons(call)).toEqual({
      method: "sendMessage",
      params: {
        text: "Reddit draft ready for r/test: My *title*\nPost to r/test: https://ferry.test/d/t1/post\nOpen draft: https://ferry.test/d/t1",
      },
    });
  });

  it("returns a call without buttons unchanged", () => {
    const call = buildTelegramAlert("Oops", null);
    expect(withoutButtons(call)).toEqual(call);
  });
});
