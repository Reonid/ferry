import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/auth/buffer/route";

afterEach(() => vi.unstubAllEnvs());

function signIn(next: string | null) {
  vi.stubEnv("BUFFER_CLIENT_ID", "ferry-client");
  vi.stubEnv("NEXT_PUBLIC_BASE_URL", "https://ferry.example");
  const url = new URL("https://ferry.example/api/auth/buffer");
  if (next !== null) url.searchParams.set("next", next);
  return GET(new NextRequest(url));
}

describe("Buffer sign-in from the consent screen", () => {
  it("remembers the consent screen to come back to", async () => {
    const res = await signIn("/oauth/authorize?client_id=c1.a.b&state=s");
    expect(res.cookies.get("ferry_next")).toMatchObject({
      value: "/oauth/authorize?client_id=c1.a.b&state=s",
      httpOnly: true,
      maxAge: 600,
    });
    expect(res.headers.get("location")).toMatch(
      /^https:\/\/auth\.buffer\.com\/auth\?/,
    );
  });

  it("clears it for any other page", async () => {
    for (const next of [null, "/app", "https://evil.example/oauth/authorize"]) {
      const res = await signIn(next);
      expect(res.cookies.get("ferry_next")?.value ?? "", String(next)).toBe("");
    }
  });
});
