import { DRAFT_TTL_S } from "../../constants";
import type { Store } from "../../store/store";
import type { RedditDraft } from "../../types";
import { redditSubmitPage } from "./draft";

/** Draft tokens are base64url; the dev seed uses a readable one. */
const TOKEN = /^[\w-]{1,64}$/;

/**
 * The draft behind a /d/{token} link, or null when it doesn't exist, has
 * expired, or its post link isn't Reddit's submit page for its subreddit.
 * The draft page and its /post redirect both go through here, so neither
 * can send anyone off Reddit.
 */
export async function findLiveDraft(
  store: Pick<Store, "getDraft">,
  token: string,
  now: number,
): Promise<RedditDraft | null> {
  if (!TOKEN.test(token)) return null;
  const draft = await store.getDraft(token);
  return draft && isLiveDraft(draft, now) ? draft : null;
}

/** Unexpired, and its post link is Reddit's submit page for its subreddit. */
export function isLiveDraft(draft: RedditDraft, now: number): boolean {
  // Redis expires drafts on its own; this keeps the promise without it.
  if (now >= draft.createdAt + DRAFT_TTL_S * 1000) return false;
  const page = redditSubmitPage(draft.subreddit);
  return draft.submitUrl === page || draft.submitUrl.startsWith(`${page}?`);
}
