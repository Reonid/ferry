import { describe, expect, it } from "vitest";
import { splitText } from "./split";

describe("splitText", () => {
  it("splits at paragraphs before sentences", () => {
    const a = "First paragraph. It has two sentences.";
    const b = "Second paragraph here.";
    expect(splitText(`${a}\n\n${b}`, 50)).toEqual([a, b]);
  });

  it("never cuts inside a URL that fits", () => {
    const url = "https://example.com/a/very/long/path/that/fits";
    const out = splitText(`${"word ".repeat(7)}${url} tail`, 50);
    expect(out.some((part) => part.includes(url))).toBe(true);
    for (const part of out) expect(part.length).toBeLessThanOrEqual(50);
  });
});
