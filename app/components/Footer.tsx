import Link from "next/link";
import { DISCLAIMER } from "./disclaimer";
import styles from "./Footer.module.css";

export default function Footer() {
  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <p className={styles.disclaimer}>{DISCLAIMER}</p>
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
