import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import { DRAFT_TTL_S } from "@/lib/constants";
import { relativeTime } from "@/lib/dashboard/view";
import { redditSubmitPage } from "@/lib/destinations/reddit/draft";
import { findLiveDraft } from "@/lib/destinations/reddit/lookup";
import { getStore } from "@/lib/store";
import type { MirrorImage } from "@/lib/types";
import { DraftIcon, ExternalIcon } from "@/app/components/icons";
import SiteHeader from "@/app/components/SiteHeader";
import ui from "@/app/components/ui.module.css";
import CopyField from "./CopyField";
import styles from "./page.module.css";

// The link is the only key to a draft: keep it out of search engines and
// out of the Referer header sent to Reddit or an image host.
export const metadata: Metadata = {
  title: "Reddit draft",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/** Images are linked only over https, or from this site in development. */
function linkable(image: MirrorImage): boolean {
  return /^https:\/\//i.test(image.url) || /^\/(?!\/)/.test(image.url);
}

function NewTab() {
  return <span className="visually-hidden"> (opens in a new tab)</span>;
}

async function load(token: string) {
  const now = Date.now();
  return { draft: await findLiveDraft(getStore(), token, now), now };
}

export default async function DraftPage(props: PageProps<"/d/[token]">) {
  const { draft, now } = await load((await props.params).token);
  if (!draft) notFound();

  const sub = `r/${draft.subreddit}`;
  const images = draft.images.filter(linkable);
  return (
    <>
      <SiteHeader />
      <main id="main" className={ui.page}>
        <div className={styles.draft}>
          <div className={styles.intro}>
            <h1 className={ui.title}>Reddit draft for {sub}</h1>
            <div className={styles.status}>
              <p className={styles.badge}>
                <DraftIcon className={styles.badgeIcon} />
                Ready to post
              </p>
              <p className={styles.meta}>
                Prepared {relativeTime(draft.createdAt, now)}. Expires{" "}
                {relativeTime(draft.createdAt + DRAFT_TTL_S * 1000, now)}.
              </p>
            </div>
          </div>

          <div className={styles.post}>
            {/* Straight to Reddit: this page already has the draft. */}
            <a
              href={draft.submitUrl}
              target="_blank"
              rel="noreferrer"
              className={`${ui.button} ${ui.primary} ${ui.large}`}
            >
              Post to {sub}
              <ExternalIcon className={ui.icon} />
              <NewTab />
            </a>
            <p className={ui.hint}>
              Opens Reddit with the title and{" "}
              {draft.kind === "link" ? "link" : "text"} filled in. Nothing is
              posted until you press Post there.
              {images.length > 0 && " Attach the images below by hand."}
            </p>
          </div>

          <div className={styles.fields}>
            <CopyField label="Title" value={draft.title} />
            {draft.kind === "link" && draft.url && (
              <CopyField label="Link" value={draft.url} />
            )}
            {draft.body && <CopyField label="Body text" value={draft.body} />}
          </div>

          {images.length > 0 && (
            <section aria-labelledby="images-title" className={styles.images}>
              <h2 id="images-title" className={ui.heading}>
                Images
              </h2>
              <p>
                Reddit doesn&apos;t accept images through links, so attach these
                by hand.
              </p>
              <ol role="list" className={styles.imageList}>
                {images.map((image, i) => (
                  <li key={`${i}-${image.url}`} className={styles.image}>
                    <a
                      href={image.url}
                      target="_blank"
                      rel="noreferrer"
                      className={styles.imageLink}
                    >
                      {/* Decorative: the link and the alt text below say what it is. */}
                      <Image
                        src={image.url}
                        alt=""
                        width={160}
                        height={120}
                        unoptimized
                        className={styles.thumb}
                      />
                      <span>
                        Open image {i + 1}
                        <NewTab />
                      </span>
                    </a>
                    <p className={styles.alt}>
                      {image.alt ? `Alt text: ${image.alt}` : "No alt text."}
                    </p>
                  </li>
                ))}
              </ol>
            </section>
          )}

          <div className={styles.fallback}>
            <p>
              If Reddit opens without your draft filled in, copy each part above
              and paste it in.
            </p>
            <a
              href={redditSubmitPage(draft.subreddit)}
              target="_blank"
              rel="noreferrer"
              className={ui.button}
            >
              Open {sub} without prefill
              <NewTab />
            </a>
          </div>
        </div>
      </main>
    </>
  );
}
