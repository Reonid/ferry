import type { MirrorPost } from "../types";

/** "2/", "2/5" or "(2/5)" at the start: the author numbered it already. */
const NUMBERED = /^\s*\(?\d+\s*\//;

/**
 * A post's text, then each later post of its thread numbered from the
 * second on ("2/3"), so a thread doesn't read as one long post. A part the
 * author numbered keeps just their number. An empty part is left out but
 * keeps its place in the numbering.
 */
export function threadParts(
  post: Pick<MirrorPost, "text" | "threadTexts">,
): { label: string | null; text: string }[] {
  const all = [post.text, ...post.threadTexts];
  return all.flatMap((text, i) =>
    text
      ? [
          {
            label:
              i === 0 || NUMBERED.test(text) ? null : `${i + 1}/${all.length}`,
            text,
          },
        ]
      : [],
  );
}
