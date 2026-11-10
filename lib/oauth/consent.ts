import { authorizationRedirect, checkAuthorizationRequest } from "./authorize";
import { issueCode, type OAuthContext } from "./tokens";

export type ConsentResult =
  { status: 303; location: string } | { status: 400 | 403; message: string };

/**
 * The owner's answer on the consent screen. The request is checked again
 * from scratch, since only its query came back with the form. The answer
 * must come from Ferry's own page, which a cross-site form can't fake: its
 * Origin header would name the other site.
 */
export async function decideConsent(args: {
  ctx: OAuthContext;
  origin: string | null;
  accountId: string | null;
  params: URLSearchParams;
  allow: boolean;
}): Promise<ConsentResult> {
  const { ctx, params } = args;
  if (args.origin !== new URL(ctx.issuer).origin)
    return {
      status: 403,
      message: "Ferry only takes this answer from its own page.",
    };
  const check = checkAuthorizationRequest(params, ctx);
  if (!check.ok)
    return check.redirect === null
      ? { status: 400, message: check.message }
      : { status: 303, location: check.redirect };

  const account = args.accountId
    ? await ctx.store.getAccount(args.accountId)
    : null;
  // Signed out in the meantime: back to the screen, which asks to sign in.
  if (!account)
    return {
      status: 303,
      location: `${ctx.issuer}/oauth/authorize?${params.toString()}`,
    };

  const { request } = check;
  const answer: Record<string, string> = args.allow
    ? { code: await issueCode(ctx, account.accountId, request) }
    : {
        error: "access_denied",
        error_description: "The owner chose not to connect Ferry.",
      };
  return {
    status: 303,
    location: authorizationRedirect(request.redirectUri, {
      ...answer,
      state: request.state,
      iss: ctx.issuer,
    }),
  };
}
