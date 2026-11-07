import { TELEGRAM_POST_TIMEOUT_MS } from "../../constants";

export type TelegramResult<T> =
  | { ok: true; result: T }
  | {
      ok: false;
      status: number;
      description: string;
      retryAfterMs: number | null;
      migrated: boolean;
    };

/**
 * Calls a Bot API method. The URL holds the bot token, so nothing here ever
 * echoes the URL or an error's message: a failure carries only Telegram's own
 * description, an HTTP status, or "network".
 */
export async function telegramCall<T>(args: {
  token: string;
  method: string;
  params: Record<string, unknown>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<TelegramResult<T>> {
  const doFetch = args.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await doFetch(
      `https://api.telegram.org/bot${args.token}/${args.method}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(args.params),
        signal: AbortSignal.timeout(args.timeoutMs ?? TELEGRAM_POST_TIMEOUT_MS),
      },
    );
  } catch {
    return {
      ok: false,
      status: 0,
      description: "network",
      retryAfterMs: null,
      migrated: false,
    };
  }
  const json = (await res.json().catch(() => null)) as {
    ok?: unknown;
    result?: T;
    description?: unknown;
    parameters?: { retry_after?: unknown; migrate_to_chat_id?: unknown };
  } | null;
  if (res.ok && json?.ok === true)
    return { ok: true, result: json.result as T };
  const retry = Number(json?.parameters?.retry_after);
  return {
    ok: false,
    status: res.status,
    description:
      typeof json?.description === "string"
        ? json.description
        : `HTTP ${res.status}`,
    retryAfterMs:
      json?.parameters?.retry_after != null && Number.isFinite(retry)
        ? Math.ceil(retry * 1000)
        : null,
    migrated: json?.parameters?.migrate_to_chat_id != null,
  };
}
