"use client";

import ui from "@/app/components/ui.module.css";
import styles from "./error.module.css";

/** Shown when the dashboard or one of its actions throws unexpectedly. */
export default function DashboardError({
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <main id="main" className={styles.main}>
      <div className={`${ui.card} ${styles.card}`}>
        <h1 className={ui.heading}>The dashboard hit an error</h1>
        <p className={styles.text}>
          Your last change may not have gone through. Try again, and reload the
          page if this keeps happening.
        </p>
        <div>
          <button
            type="button"
            className={`${ui.button} ${ui.primary}`}
            onClick={() => retry()}
          >
            Try again
          </button>
        </div>
      </div>
    </main>
  );
}
