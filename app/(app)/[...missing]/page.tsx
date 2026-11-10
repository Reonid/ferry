import type { Metadata } from "next";
import { notFound } from "next/navigation";

// The tab reads "Page not found – Ferry" rather than the bare name.
export const metadata: Metadata = { title: "Page not found" };

/**
 * Any address no route matches. With a root layout per route group there
 * is no top-level not-found, so this hands the 404 to this group's one.
 */
export default function Missing(): never {
  notFound();
}
