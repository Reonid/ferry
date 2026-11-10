import { BUFFER_SCOPE } from "@/lib/auth/buffer-oauth";

/** What each scope Ferry asks Buffer for lets it do, in plain words. */
const MEANING: Record<string, string> = {
  "account:read": "Your account",
  "posts:read": "Your posts",
  offline_access: "The right to keep checking",
};

export const BUFFER_SCOPE_PARTS: [string, string][] = BUFFER_SCOPE.split(
  " ",
).map((scope) => [scope, MEANING[scope] ?? scope]);
