import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ferry",
  description:
    "Ferry carries your Buffer posts to the places Buffer doesn't go.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        {children}
        <footer>
          Ferry is an independent project built on the Buffer API. It is not
          affiliated with or endorsed by Buffer.
        </footer>
      </body>
    </html>
  );
}
