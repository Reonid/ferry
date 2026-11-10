import { Onest } from "next/font/google";

/*
 * Ferry's face: Onest, a calm, friendly sans, for heads and text alike.
 * Served from this site through next/font, so no request leaves a
 * visitor's browser for Google (the privacy page lists every processor).
 * Both root layouts put the variable on <html>, and app/styles/tokens.css
 * points --font-display and --font-body at it.
 */
const onest = Onest({
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500"],
  variable: "--font-onest",
  display: "swap",
});

/** The class names that define the font variable. */
export const fontVariables = onest.variable;
