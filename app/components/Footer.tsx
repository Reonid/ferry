import Link from "next/link";
import BrandMark from "./BrandMark";
import { DISCLAIMER } from "./disclaimer";
import styles from "./Footer.module.css";

export default function Footer() {
  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <div className={styles.about}>
          <p className={styles.name} aria-hidden="true">
            <BrandMark className={styles.mark} />
            Ferry
          </p>
          <p className={styles.disclaimer}>{DISCLAIMER}</p>
        </div>
        <ul className={styles.links}>
          <li>
            <Link href="/privacy">Privacy</Link>
          </li>
          <li>
            <a href="https://github.com/Reonid/ferry">Source on GitHub</a>
          </li>
        </ul>
      </div>
    </footer>
  );
}
