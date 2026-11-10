import Link from "next/link";
import { DRAFT_TTL_S } from "@/lib/constants";
import { relativeTime } from "@/lib/dashboard/view";
import type { PublicDestination, RedditDraft } from "@/lib/types";
import { ArrowIcon, DraftIcon } from "@/app/components/icons";
import ui from "@/app/components/ui.module.css";
import styles from "./DraftsTray.module.css";

/**
 * The Reddit drafts waiting to be posted. It only shows for an account
 * that sends posts to a subreddit, or still has drafts from one.
 */
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
  if (!hasSubreddit && drafts.length === 0) return null;
  return (
    <section id="drafts" aria-labelledby="drafts-title" className={ui.card}>
      <h2 id="drafts-title" className={ui.heading}>
        Reddit drafts
      </h2>
      {drafts.length === 0 ? (
        <p className={styles.empty}>
          No drafts waiting. Each post routed to a subreddit waits here.
        </p>
      ) : (
        <ul className={styles.list}>
          {drafts.map((draft) => (
            <li key={draft.token} className={styles.draft}>
              <span className={styles.icon}>
                <DraftIcon />
              </span>
              <div className={styles.body}>
                <Link
                  href={`/d/${draft.token}`}
                  prefetch={false}
                  className={styles.title}
                >
                  {draft.title}
                  <ArrowIcon className={styles.arrow} />
                </Link>
                <p className={styles.meta}>
                  r/{draft.subreddit}, prepared{" "}
                  {relativeTime(draft.createdAt, now)}. Expires{" "}
                  {relativeTime(draft.createdAt + DRAFT_TTL_S * 1000, now)}.
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
