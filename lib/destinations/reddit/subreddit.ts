const VALID = /^(u_)?[A-Za-z0-9][A-Za-z0-9_]{1,20}$/;

export function normalizeSubreddit(input: string): string | null {
  let s = input.trim();
  s = s.replace(/^https?:\/\/(?:[a-z]+\.)?reddit\.com/i, "");
  s = s.replace(/^\/+/, "");
  const m = /^(r|u|user)\/([^/?#]+)/i.exec(s);
  let name: string;
  if (m) {
    name = m[1]!.toLowerCase() === "r" ? m[2]! : `u_${m[2]!}`;
  } else {
    name = s.replace(/\/+$/, "");
  }
  return VALID.test(name) ? name : null;
}
