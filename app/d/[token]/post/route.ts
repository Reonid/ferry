import { NextResponse } from "next/server";
import { findLiveDraft } from "@/lib/destinations/reddit/lookup";
import { getStore } from "@/lib/store";
import { DISCLAIMER } from "../../../components/disclaimer";

/*
 * Shown when a Discord button outlives its draft. Next answers notFound()
 * in a route handler with an empty body, which browsers show as their own
 * error page, so this says what happened. It stands alone: a route handler
 * can't render the app's layout. Colors are the chart tokens.
 */
const GONE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Draft not found – Ferry</title>
<style>
:root { color-scheme: light dark; --sea: #f3f7f8; --ink: #15283f; --muted: #44586c; --rule: #bacbd4; --route: #a1197f; }
@media (prefers-color-scheme: dark) { :root { --sea: #0d1b2a; --ink: #dce6ee; --muted: #a3b5c4; --rule: #2b4357; --route: #ee8fd7; } }
body { margin: 0; padding: 3rem 1rem; background: var(--sea); color: var(--ink); font: 1rem/1.5 system-ui, sans-serif; }
main, footer { max-width: 42rem; margin: 0 auto; }
h1 { margin: 0 0 1rem; font: italic 500 2rem/1.1 Georgia, serif; }
a { color: var(--route); }
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
