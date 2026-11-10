import Link from "next/link";
import SiteHeader from "@/app/components/SiteHeader";
import ui from "@/app/components/ui.module.css";
import styles from "./page.module.css";

/** A draft link that has expired, was deleted, or never existed. */
export default function DraftNotFound() {
  return (
    <>
      <SiteHeader />
      <main id="main" className={ui.page}>
        <div className={`${styles.draft} ${styles.gone}`}>
          <h1 className={ui.title}>Draft not found</h1>
          <p>
            It may have expired or been deleted. Ferry keeps each Reddit draft
            for 7 days.
          </p>
          <p>Drafts still waiting for you are on your dashboard.</p>
          <Link href="/app" className={`${ui.button} ${ui.primary}`}>
            Open Ferry
          </Link>
        </div>
      </main>
    </>
  );
}
