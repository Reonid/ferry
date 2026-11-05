import type { DeliveryOutcome } from "../../types";
import { fetchImage } from "../../net/fetch-image";
import type { DiscordMessage } from "./format";

type Failure = Extract<DeliveryOutcome, { ok: false }>;

async function buildBody(
  message: DiscordMessage,
  fetchImageImpl: typeof fetchImage,
): Promise<{ body: string | FormData; headers: Record<string, string> }> {
  const { files = [], ...rest } = message;
  const embeds = [...(rest.embeds ?? [])];
  const fetched: { filename: string; alt: string; blob: Blob }[] = [];
  for (const f of files) {
    const img = await fetchImageImpl(f.url);
    if (img) {
      fetched.push({
        filename: f.filename,
        alt: f.alt,
        blob: new Blob([img.bytes as BlobPart], {
          type: img.mimeType || f.mimeType,
        }),
      });
    } else {
      embeds.push({ image: { url: f.url } });
    }
  }
  const payload: Record<string, unknown> = { ...rest };
  if (embeds.length) payload.embeds = embeds;
  if (!fetched.length) {
    return {
      body: JSON.stringify(payload),
      headers: { "content-type": "application/json" },
    };
  }
  payload.attachments = fetched.map((f, id) => ({
    id,
    filename: f.filename,
    description: f.alt,
  }));
  const form = new FormData();
  form.set("payload_json", JSON.stringify(payload));
  fetched.forEach((f, i) => form.set(`files[${i}]`, f.blob, f.filename));
  return { body: form, headers: {} };
}

async function failureFor(res: Response, sentCount: number): Promise<Failure> {
  const json = (await res.json().catch(() => null)) as {
    message?: unknown;
    retry_after?: unknown;
  } | null;
  if (res.status === 429) {
    const secs = Number(json?.retry_after);
    return {
      ok: false,
      retryable: true,
      reason: "Discord rate limit",
      retryAfterMs: Number.isFinite(secs) ? Math.ceil(secs * 1000) : 1000,
      sentCount,
    };
  }
  if (res.status === 401 || res.status === 404) {
    return {
      ok: false,
      retryable: false,
      reason: "The Discord webhook no longer exists",
      destinationBroken: true,
      sentCount,
    };
  }
  if (res.status >= 500) {
    return {
      ok: false,
      retryable: true,
      reason: `Discord server error (HTTP ${res.status})`,
      sentCount,
    };
  }
  const detail = typeof json?.message === "string" ? json.message : null;
  return {
    ok: false,
    retryable: false,
    reason: detail
      ? `Discord rejected the message: ${detail}`
      : `Discord rejected the message (HTTP ${res.status})`,
    sentCount,
  };
}

/**
 * Sends messages in order starting at `startAt`. `sentCount` on failures is the
 * absolute number of messages already delivered (including those before startAt).
 * The returned url points at the first message sent by this call.
 */
export async function sendDiscordMessages(args: {
  webhookId: string;
  webhookToken: string;
  guildId: string;
  messages: DiscordMessage[];
  startAt?: number;
  fetchImpl?: typeof fetch;
  fetchImageImpl?: typeof fetchImage;
}): Promise<DeliveryOutcome> {
  const doFetch = args.fetchImpl ?? fetch;
  const imageImpl = args.fetchImageImpl ?? fetchImage;
  const endpoint = `https://discord.com/api/webhooks/${args.webhookId}/${args.webhookToken}?wait=true&with_components=true`;
  const start = args.startAt ?? 0;
  let url: string | undefined;

  for (let i = start; i < args.messages.length; i++) {
    let res: Response;
    try {
      const { body, headers } = await buildBody(args.messages[i]!, imageImpl);
      res = await doFetch(endpoint, { method: "POST", headers, body });
    } catch {
      return {
        ok: false,
        retryable: true,
        reason: "Could not reach Discord",
        sentCount: i,
      };
    }
    if (!res.ok) return failureFor(res, i);
    if (url === undefined) {
      const created = (await res.json().catch(() => null)) as {
        id?: unknown;
        channel_id?: unknown;
      } | null;
      if (
        typeof created?.id === "string" &&
        typeof created.channel_id === "string"
      ) {
        url = `https://discord.com/channels/${args.guildId}/${created.channel_id}/${created.id}`;
      }
    }
  }
  return url ? { ok: true, url } : { ok: true };
}
