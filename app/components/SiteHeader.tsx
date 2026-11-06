import Link from "next/link";
import type { ReactNode } from "react";
import BrandMark from "./BrandMark";
import styles from "./SiteHeader.module.css";

/**
 * The bar along the top of every page: the boat and the name, plus any page
 * links. The name is the dashboard's h1, the landing's current-page link,
 * and a link home everywhere else.
 */
export default function SiteHeader({
  brand = "link",
  children,
}: {
  brand?: "link" | "current" | "heading";
  children?: ReactNode;
}) {
  const name = (
    <>
      <BrandMark />
      Ferry
    </>
  );
  return (
    <header className={styles.header}>
      <div className={styles.bar}>
        {brand === "heading" ? (
          <h1 className={styles.brand}>{name}</h1>
        ) : (
          <Link
            href="/"
            className={styles.brand}
            aria-current={brand === "current" ? "page" : undefined}
          >
            {name}
          </Link>
        )}
        {children}
      </div>
    </header>
  );
}
