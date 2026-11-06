import type { Metadata, Viewport } from "next";
import { Atkinson_Hyperlegible_Next, Piazzolla } from "next/font/google";
import Footer from "./components/Footer";
import "./globals.css";

// Names and controls: a typeface drawn for low-vision legibility.
const body = Atkinson_Hyperlegible_Next({
  subsets: ["latin", "latin-ext"],
  variable: "--font-atkinson",
  display: "swap",
  // Next has no fallback metrics for this family yet.
  adjustFontFallback: false,
  fallback: ["system-ui", "sans-serif"],
});

// Things on the water, in the italic that charts use for sea names.
const water = Piazzolla({
  subsets: ["latin", "latin-ext"],
  style: "italic",
  axes: ["opsz"],
  variable: "--font-piazzolla",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "Ferry", template: "%s – Ferry" },
  description:
    "Ferry carries your Buffer posts to the places Buffer doesn't go.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f3f7f8" },
    { media: "(prefers-color-scheme: dark)", color: "#0d1b2a" },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${body.variable} ${water.variable}`}>
      <body>
        {children}
        <Footer />
      </body>
    </html>
  );
}
