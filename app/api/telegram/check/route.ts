import {
  checkTelegramLink,
  isLinkCode,
} from "@/lib/destinations/telegram/link";
import { telegramConfig } from "@/lib/env";
import { getSession } from "@/lib/session";
import { getStore } from "@/lib/store";

export const maxDuration = 30;

export async function POST(request: Request): Promise<Response> {
  const session = await getSession();
  const accountId = session.accountId;
  if (!accountId) return new Response("Unauthorized", { status: 401 });
  const store = getStore();
  if (!(await store.getAccount(accountId)))
    return new Response("Unauthorized", { status: 401 });

  const telegram = telegramConfig();
  if (!telegram) return new Response("Not found", { status: 404 });

  const body: unknown = await request.json().catch(() => null);
  const code =
    typeof body === "object" && body !== null && "code" in body
      ? (body as { code: unknown }).code
      : null;
  if (typeof code !== "string" || !isLinkCode(code))
    return new Response("Bad request", { status: 400 });

  return Response.json(
    await checkTelegramLink(
      { store, now: Date.now(), telegram },
      accountId,
      code,
    ),
  );
}
