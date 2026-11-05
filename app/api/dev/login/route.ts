import { NextResponse } from "next/server";
import { seedDevAccount } from "@/lib/dev/seed";
import { baseUrl } from "@/lib/env";
import { getSession } from "@/lib/session";
import { getStore } from "@/lib/store";

export async function GET(): Promise<NextResponse> {
  if (
    process.env.NODE_ENV !== "development" ||
    process.env.FERRY_DEV_LOGIN !== "1"
  ) {
    return new NextResponse("Not found", { status: 404 });
  }
  const accountId = await seedDevAccount(getStore(), Date.now());
  const session = await getSession();
  session.accountId = accountId;
  await session.save();
  return NextResponse.redirect(`${baseUrl()}/app`);
}
