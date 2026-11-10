import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import eslintConfigPrettier from "eslint-config-prettier/flat";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Local design-tool state, kept out of git: tasteskill's Chrome
    // profiles, impeccable's critiques and Hallmark's lint records.
    ".taste-skill/**",
    ".impeccable/**",
    ".hallmark/**",
  ]),
  {
    rules: {
      // The app's 404 is a catch-all page (app/(app)/[...missing]), the
      // stand-in for a global not-found across two root layouts. It matches
      // every path, so this rule would take each <a> for a page link,
      // including the ones to route handlers (/api/...) that must stay <a>.
      "@next/next/no-html-link-for-pages": "off",
    },
  },
  eslintConfigPrettier,
]);

export default eslintConfig;
