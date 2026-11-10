import type { Metadata, Viewport } from "next";
import { optionalEnv } from "@/lib/env";
import { SHARE_IMAGE } from "@/app/components/share-image";
import { fontVariables } from "@/app/fonts";
import "./site.css";

/*
 * The landing's own document. The app's pages keep their own root layout
 * in app/(app); both read the same tokens, base and faces, so the two look
 * like one product.
 */

const TITLE = "Ferry: Buffer posts on Discord, Telegram and Reddit";
const DESCRIPTION =
  "Ferry sends the posts Buffer publishes to your Discord and Telegram channels, and prepares Reddit drafts you post with one tap.";
// Gives the share image an absolute URL. Unset, Next falls back to the
// deployment's own URL.
const base = optionalEnv("NEXT_PUBLIC_BASE_URL");

export const metadata: Metadata = {
  ...(base ? { metadataBase: new URL(base) } : {}),
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    type: "website",
    siteName: "Ferry",
    title: TITLE,
    description:
      "Your Buffer posts, carried on to Discord, Telegram and Reddit.",
    images: [SHARE_IMAGE],
  },
  twitter: { card: "summary_large_image", images: [SHARE_IMAGE] },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f3f8f2" },
    { media: "(prefers-color-scheme: dark)", color: "#070e0b" },
  ],
};

/** Marks a page that runs scripts, before the first paint: tabs hide their
 *  other panels only then, so every panel shows with scripting off. */
const JS = `document.documentElement.classList.add('js')`;

export default function SiteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={fontVariables} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: JS }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
