import { DECK, HULL } from "./boat";
import styles from "./BrandMark.module.css";

/** Ferry's logo: the boat that crosses the map, with its wake. */
export default function BrandMark() {
  return (
    <svg className={styles.mark} viewBox="-27 -9 42 18" aria-hidden="true">
      <path className={styles.wake} d="M -15 -2.6 L -25 -7 M -15 2.6 L -25 7" />
      <path className={styles.hull} d={HULL} />
      <path className={styles.deck} d={DECK} />
    </svg>
  );
}
