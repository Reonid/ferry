# Ferry

## Global Constraints

- Node 24: `.nvmrc` is `24`, `engines.node` is `>=24`. TypeScript `strict` plus `noUncheckedIndexedAccess`.
- Next.js 16 differs from older versions. Before writing route handlers, server actions, `proxy.ts` or `cookies()` code, read the matching guide in `node_modules/next/dist/docs/`. `cookies()` is async.
- Dependencies are exactly the Tech Stack list plus their `@types`, ESLint, Prettier and `eslint-config-next`/`eslint-config-prettier`. Add nothing else.
- Buffer access is read-only. The OAuth scope string is exactly `account:read posts:read offline_access`. No code path sends a Buffer mutation.
- Endpoints:
  - Buffer authorize `https://auth.buffer.com/auth`, token `https://auth.buffer.com/token`, API `https://api.buffer.com` (POST JSON `{query, variables}`).
  - Discord authorize `https://discord.com/oauth2/authorize`, token `https://discord.com/api/oauth2/token`, execute `https://discord.com/api/webhooks/{id}/{token}`.
- Every Redis key starts with `ferry:`. Stored times are epoch milliseconds. Fields copied from Buffer keep Buffer's ISO strings.
- Pure modules take the clock as a parameter and never call `Date.now()`: `lib/routing/*`, `lib/mirror/*`, `lib/sync/planner.ts`, `lib/sync/budget.ts`, `lib/destinations/*/format.ts`, `lib/destinations/reddit/draft.ts`.
- Tokens, Discord webhook tokens and post text are never logged. OAuth tokens and webhook tokens never reach the browser. The signed-in owner's own dashboard may show their own post excerpts and Reddit drafts.
- The product name is "Ferry". Every page's footer reads exactly: "Ferry is an independent project built on the Buffer API. It is not affiliated with or endorsed by Buffer."
- Accessibility: full keyboard path, visible focus, WCAG AA in light and dark, `prefers-reduced-motion` respected, live updates through `aria-live="polite"`.
- Small conventional commits (`feat:`, `fix:`, `test:`, `chore:`, `docs:`, `ci:`). Stage files by name, never `git add -A`. Every commit leaves `npm run lint`, `npm run typecheck` and `npm test` green.
- Implementers never deploy, change GitHub settings, or touch real credentials. Task 14 is run by the controller with Leon.

## Commands

- `npm run dev`: dev server over HTTPS
- `npm run dev:e2e`: dev server on port 3100 with `FERRY_DEV_LOGIN=1`
- `npm run build` / `npm start`: production build and server
- `npm run lint`: ESLint
- `npm run typecheck`: `next typegen && tsc --noEmit`
- `npm run format` / `npm run format:check`: Prettier
- `npm test`: Vitest
- `npm run test:e2e`: Playwright

Next.js's own notes for coding agents are in @AGENTS.md, which `next dev` keeps current.
