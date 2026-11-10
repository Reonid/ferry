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
  eslintConfigPrettier,
]);

export default eslintConfig;
