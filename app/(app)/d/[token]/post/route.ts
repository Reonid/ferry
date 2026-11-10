import { NextResponse } from "next/server";
import { findLiveDraft } from "@/lib/destinations/reddit/lookup";
import { getStore } from "@/lib/store";
import { DISCLAIMER } from "@/app/components/disclaimer";

/*
 * Shown when a Discord button outlives its draft. Next answers notFound()
 * in a route handler with an empty body, which browsers show as their own
 * error page, so this says what happened. It stands alone: a route handler
 * can't render the app's layout. Its colours copy the paper, ink, rule
 * and accent tokens in app/styles/tokens.css.
 */
const GONE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Draft not found – Ferry</title>
<style>
:root { color-scheme: light dark; --paper: #fcfbf7; --ink: #10231d; --muted: #5b6660; --rule: #e7e2d5; --accent: #1d6b4e; }
@media (prefers-color-scheme: dark) { :root { --paper: #111a17; --ink: #eef2ee; --muted: #a3afa8; --rule: #2a3631; --accent: #7fd3a9; } }
body { margin: 0; padding: 4rem 1rem; background: var(--paper); color: var(--ink); font: 1rem/1.5 system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
main, footer { max-width: 42rem; margin: 0 auto; }
h1 { margin: 0 0 1rem; font: 400 2.75rem/1.05 system-ui, sans-serif; letter-spacing: -0.025em; }
a { color: var(--accent); }
footer { margin-top: 3rem; padding-top: 1.5rem; border-top: 1px solid var(--rule); color: var(--muted); font-size: 0.875rem; }
footer a { margin-right: 1.5rem; }
</style>
</head>
<body>
<main>
<h1>Draft not found</h1>
<p>It may have expired or been deleted. Ferry keeps each Reddit draft for 7 days.</p>
<p><a href="/app">Open Ferry</a></p>
</main>
<footer>
<p>${DISCLAIMER}</p>
<p><a href="/privacy">Privacy</a><a href="https://github.com/Reonid/ferry">Source on GitHub</a></p>
</footer>
</body>
</html>
`;

/**
 * Discord's draft notice links its "Post to r/{sub}" button here, because
 * Discord caps button links at 512 characters and a prefilled Reddit link
 * can be far longer. Forwards to Reddit with the draft filled in.
 */
export async function GET(
  _request: Request,
  ctx: RouteContext<"/d/[token]/post">,
): Promise<Response> {
  const { token } = await ctx.params;
  const draft = await findLiveDraft(getStore(), token, Date.now());
  if (!draft)
    return new Response(GONE, {
      status: 404,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  return NextResponse.redirect(draft.submitUrl, 302);
}
