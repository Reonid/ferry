import type { RedditDraft } from "../../types";
import { escapeDiscordMarkdown, type DiscordMessage } from "../discord/format";

export function buildDraftNotice(
  draft: RedditDraft,
  draftPageUrl: string,
): DiscordMessage {
  const sub = draft.subreddit;
  return {
    content: `Reddit draft ready for r/${sub}: **${escapeDiscordMarkdown(draft.title)}**`,
    username: "Ferry",
    allowed_mentions: { parse: [] },
    components: [
      {
        type: 1,
        components: [
          {
            type: 2,
            style: 5,
            label: `Post to r/${sub}`,
            url: `${draftPageUrl}/post`,
          },
          { type: 2, style: 5, label: "Open draft", url: draftPageUrl },
        ],
      },
    ],
  };
}
