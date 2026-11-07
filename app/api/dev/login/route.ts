import { NextResponse } from "next/server";
import { seedDevAccount } from "@/lib/dev/seed";
import { getSession } from "@/lib/session";
import { getStore } from "@/lib/store";

export async function GET(request: Request): Promise<NextResponse> {
  if (
    process.env.NODE_ENV !== "development" ||
    process.env.FERRY_DEV_LOGIN !== "1" ||
    // The seed overwrites records in place: it only ever gets the in-memory store.
    process.env.UPSTASH_REDIS_REST_URL ||
    process.env.KV_REST_API_URL
  ) {
    return new NextResponse("Not found", { status: 404 });
  }
  const accountId = await seedDevAccount(getStore(), Date.now());
  const session = await getSession();
  session.accountId = accountId;
  await session.save();
  // Relative to the request: the session cookie lives on the host that sent it.
  return NextResponse.redirect(new URL("/app", request.url));
}
