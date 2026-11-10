import type { Metadata, Viewport } from "next";
import { optionalEnv } from "@/lib/env";
import { SHARE_IMAGE } from "@/app/components/share-image";
import Footer from "@/app/components/Footer";
import { fontVariables } from "@/app/fonts";
import "./app.css";

const DESCRIPTION =
  "Ferry carries your Buffer posts to the places Buffer doesn't go.";
// Gives the share image an absolute URL. Unset, Next falls back to the
// deployment's own URL.
const base = optionalEnv("NEXT_PUBLIC_BASE_URL");

export const metadata: Metadata = {
  ...(base ? { metadataBase: new URL(base) } : {}),
  title: { default: "Ferry", template: "%s – Ferry" },
  description: DESCRIPTION,
  openGraph: {
    type: "website",
    siteName: "Ferry",
    title: "Ferry",
    description: DESCRIPTION,
    images: [SHARE_IMAGE],
  },
  twitter: { card: "summary_large_image", images: [SHARE_IMAGE] },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f3f8f2" },
    { media: "(prefers-color-scheme: dark)", color: "#070e0b" },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={fontVariables}>
      <body>
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        {children}
        <Footer />
      </body>
    </html>
  );
}
