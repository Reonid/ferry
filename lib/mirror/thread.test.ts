import { describe, expect, it } from "vitest";
import { threadParts } from "./thread";

describe("threadParts", () => {
  it("leaves a single post unnumbered", () => {
    expect(threadParts({ text: "one", threadTexts: [] })).toEqual([
      { label: null, text: "one" },
    ]);
  });

  it("numbers a thread's later posts", () => {
    expect(threadParts({ text: "one", threadTexts: ["two", "three"] })).toEqual(
      [
        { label: null, text: "one" },
        { label: "2/3", text: "two" },
        { label: "3/3", text: "three" },
      ],
    );
  });

  it("doesn't number a part the author already numbered", () => {
    expect(
      threadParts({
        text: "1/4 one",
        threadTexts: ["2/ two", "(3/4) three", "4/4 four"],
      }).map((p) => p.label),
    ).toEqual([null, null, null, null]);
  });

  it("leaves out an empty part but keeps its number", () => {
    expect(threadParts({ text: "one", threadTexts: ["", "three"] })).toEqual([
      { label: null, text: "one" },
      { label: "3/3", text: "three" },
    ]);
  });
});
