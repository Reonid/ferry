import { IMAGE_MAX_BYTES, IMAGE_TIMEOUT_MS } from "../constants";

export interface FetchedImage {
  bytes: Uint8Array;
  mimeType: string;
}

/** Downloads an image over HTTPS with a time and size cap. Null on any failure. */
export async function fetchImage(
  url: string,
  opts: {
    timeoutMs?: number;
    maxBytes?: number;
    fetchImpl?: typeof fetch;
  } = {},
): Promise<FetchedImage | null> {
  const maxBytes = opts.maxBytes ?? IMAGE_MAX_BYTES;
  const doFetch = opts.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    opts.timeoutMs ?? IMAGE_TIMEOUT_MS,
  );
  try {
    if (new URL(url).protocol !== "https:") return null;
    const res = await doFetch(url, { signal: controller.signal });
    if (!res.ok || !res.body) return null;
    const declared = Number(res.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > maxBytes) return null;

    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      bytes.set(c, offset);
      offset += c.byteLength;
    }
    const mimeType =
      res.headers.get("content-type")?.split(";")[0]?.trim() ||
      "application/octet-stream";
    return { bytes, mimeType };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
