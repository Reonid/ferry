import Link from "next/link";
import SiteHeader from "@/app/components/SiteHeader";
import ui from "@/app/components/ui.module.css";
import styles from "./not-found.module.css";

/** Any address with no page behind it. */
export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main id="main" className={`${ui.page} ${styles.main}`}>
        <div className={styles.lost}>
          <h1 className={ui.title}>No ferry runs to this page</h1>
          <p className={styles.text}>
            Page not found. The link may be mistyped, or the page may have
            moved.
          </p>
          <div className={styles.links}>
            <Link href="/" className={`${ui.button} ${ui.primary}`}>
              Back to the start
            </Link>
            <Link href="/app" className={ui.button}>
              Open your dashboard
            </Link>
          </div>
        </div>
      </main>
    </>
  );
}
