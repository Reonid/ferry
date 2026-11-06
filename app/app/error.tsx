"use client";

import ui from "../components/ui.module.css";
import styles from "./error.module.css";

/** Shown when the dashboard or one of its actions throws unexpectedly. */
export default function DashboardError({
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <main className={styles.main}>
      <h1 className={ui.heading}>The dashboard hit an error</h1>
      <p>
        Your last change may not have gone through. Try again, and reload the
        page if this keeps happening.
      </p>
      <div>
        <button type="button" className={ui.button} onClick={() => retry()}>
          Try again
        </button>
      </div>
    </main>
  );
}
