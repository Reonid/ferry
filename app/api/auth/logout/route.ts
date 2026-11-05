import { NextResponse } from "next/server";
import { baseUrl } from "@/lib/env";
import { getSession } from "@/lib/session";

export async function POST(): Promise<NextResponse> {
  const session = await getSession();
  session.destroy();
  return NextResponse.redirect(`${baseUrl()}/`, 303);
}
