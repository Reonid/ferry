import { SHIP, SHIP_BOX } from "./ship";
import styles from "./BrandMark.module.css";

/**
 * Ferry's logo: the ferry and its wave on a harbour-green tile. The same
 * picture is the favicon, the home-screen icon, the Discord app's icon and
 * the Telegram bot's photo. Decorative: the name beside it says what it is.
 */
export default function BrandMark({ className }: { className?: string }) {
  return (
    <span
      className={className ? `${styles.tile} ${className}` : styles.tile}
      aria-hidden="true"
    >
      <svg
        viewBox={`0 0 ${SHIP_BOX} ${SHIP_BOX}`}
        className={styles.svg}
        focusable="false"
      >
        <path className={styles.body} d={SHIP.wave} />
        <g className={styles.ship}>
          <path className={styles.funnel} d={SHIP.funnel} />
          <path className={styles.body} d={SHIP.wheelhouse} />
          <path className={styles.body} d={SHIP.cabin} fillRule="evenodd" />
          <path className={styles.body} d={SHIP.hull} />
        </g>
      </svg>
    </span>
  );
}
