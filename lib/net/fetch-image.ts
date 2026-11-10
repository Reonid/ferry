import { isIP } from "node:net";
import {
  IMAGE_MAX_BYTES,
  IMAGE_MAX_REDIRECTS,
  IMAGE_TIMEOUT_MS,
} from "../constants";

export interface FetchedImage {
  bytes: Uint8Array;
  mimeType: string;
}

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

/** HTTPS to a named host: never localhost or an IP literal. */
function allowedTarget(url: URL): boolean {
  if (url.protocol !== "https:") return false;
  // The URL parser has already turned every IPv4 spelling into dotted quads.
  const host = url.hostname.toLowerCase().replace(/\.+$/, "");
  if (host === "localhost" || host.endsWith(".localhost")) return false;
  return isIP(host.replace(/^\[(.*)\]$/, "$1")) === 0;
}

/**
 * Downloads an image over HTTPS with a time and size cap. Redirects are
 * followed by hand, at most IMAGE_MAX_REDIRECTS of them, so every hop is
 * checked like the first. Null on any failure, or when it isn't an image.
 */
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
    let target = new URL(url);
    let res: Response;
    for (let hops = 0; ; hops++) {
      if (!allowedTarget(target)) return null;
      res = await doFetch(target.href, {
        signal: controller.signal,
        redirect: "manual",
      });
      const location = REDIRECTS.has(res.status)
        ? res.headers.get("location")
        : null;
      if (location === null) break;
      await res.body?.cancel().catch(() => undefined);
      if (hops >= IMAGE_MAX_REDIRECTS) return null;
      target = new URL(location, target);
    }
    if (!res.ok || !res.body) return null;
    const mimeType =
      res.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ??
      "";
    if (!mimeType.startsWith("image/")) return null;
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
    return { bytes, mimeType };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    // Frees any body left unread on an early return. A no-op after a full read.
    controller.abort();
  }
}
