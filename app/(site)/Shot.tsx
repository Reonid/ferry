import { getImageProps, type StaticImageData } from "next/image";
import styles from "./landing.module.css";

/**
 * A capture of Ferry's own dashboard, in the scheme the visitor reads in:
 * the light capture by day, the dark one at night. Next's optimizer serves
 * each at the width the layout needs. Captured at 2x with example channel
 * names (Your Bluesky, Your LinkedIn) in place of the dev seed's.
 */
export default function Shot({
  light,
  dark,
  alt,
  sizes,
  className,
}: {
  light: StaticImageData;
  dark: StaticImageData;
  alt: string;
  sizes: string;
  className?: string;
}) {
  const common = { alt, sizes };
  const {
    props: { srcSet: night },
  } = getImageProps({ ...common, src: dark });
  const { props } = getImageProps({ ...common, src: light, loading: "lazy" });
  return (
    <picture>
      {/* Without sizes, a source assumes 100vw and fetches the widest. */}
      <source
        media="(prefers-color-scheme: dark)"
        srcSet={night}
        sizes={sizes}
      />
      <img
        {...props}
        alt={alt}
        className={className ? `${styles.shot} ${className}` : styles.shot}
      />
    </picture>
  );
}
