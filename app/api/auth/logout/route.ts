import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";

export async function POST(request: Request): Promise<NextResponse> {
  const session = await getSession();
  session.destroy();
  // Relative to the request: the session cookie lives on the host that sent it.
  return NextResponse.redirect(new URL("/", request.url), 303);
}
