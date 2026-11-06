import Link from "next/link";
import { DRAFT_TTL_S } from "@/lib/constants";
import { relativeTime } from "@/lib/dashboard/view";
import type { PublicDestination, RedditDraft } from "@/lib/types";
import ui from "../components/ui.module.css";
import styles from "./DraftsTray.module.css";

export default function DraftsTray({
  drafts,
  destinations,
  now,
}: {
  drafts: RedditDraft[];
  destinations: PublicDestination[];
  now: number;
}) {
  const hasSubreddit = destinations.some((d) => d.kind === "reddit");
  return (
    <section id="drafts" aria-labelledby="drafts-title" className={ui.section}>
      <h2 id="drafts-title" className={ui.heading}>
        Reddit drafts
      </h2>
      {drafts.length === 0 ? (
        <p className={styles.empty}>
          {hasSubreddit
            ? "No drafts waiting. When a post crosses to a subreddit, its draft waits here."
            : "Add a subreddit under Destinations. Each post routed there waits here as a draft for you to post."}
        </p>
      ) : (
        <ul className={styles.list}>
          {drafts.map((draft) => (
            <li key={draft.token} className={styles.draft}>
              <Link
                href={`/d/${draft.token}`}
                prefetch={false}
                className={styles.title}
              >
                {draft.title}
              </Link>
              <p className={styles.meta}>
                r/{draft.subreddit}, prepared{" "}
                {relativeTime(draft.createdAt, now)}. Expires{" "}
                {relativeTime(draft.createdAt + DRAFT_TTL_S * 1000, now)}.
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
