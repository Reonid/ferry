import BrandMark from "@/app/components/BrandMark";
import styles from "./SiteNav.module.css";

/**
 * The landing's bar: the logo and name, three links into the page, and
 * the one action. It stays at the top as you read.
 */
export default function SiteNav({
  action,
}: {
  action: { href: string; label: string };
}) {
  return (
    <header className={styles.header}>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <div className={styles.inner}>
        <a href="#top" className={styles.brand}>
          <BrandMark />
          Ferry
        </a>
        <nav aria-label="Main" className={styles.links}>
          <a href="#how">How it works</a>
          <a href="#places">Destinations</a>
          <a href="#app">Dashboard</a>
          <a href="#questions">Questions</a>
        </nav>
        <a href={action.href} className={styles.action}>
          {action.label}
        </a>
      </div>
    </header>
  );
}
