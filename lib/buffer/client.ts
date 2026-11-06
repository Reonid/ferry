import type { RateLimitSnapshot } from "@/lib/types";
import { parseRateLimit } from "./ratelimit";

const ENDPOINT = "https://api.buffer.com";
const TIMEOUT_MS = 15_000;

export type BufferErrorKind = "auth" | "rate_limit" | "network" | "api";

/** A failed Buffer call. Messages never contain the access token. */
export class BufferError extends Error {
  kind: BufferErrorKind;
  status?: number;
  retryAfterMs?: number;

  constructor(
    message: string,
    details: {
      kind: BufferErrorKind;
      status?: number;
      retryAfterMs?: number;
    },
  ) {
    super(message);
    this.name = "BufferError";
    this.kind = details.kind;
    if (details.status !== undefined) this.status = details.status;
    if (details.retryAfterMs !== undefined)
      this.retryAfterMs = details.retryAfterMs;
  }
}

function parseRetryAfter(
  value: string | null,
  now: number,
): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0)
    return Math.round(seconds * 1000);
  const at = Date.parse(value);
  if (Number.isNaN(at)) return undefined;
  return Math.max(0, at - now);
}

interface GraphQLError {
  message?: unknown;
  extensions?: { code?: unknown };
}

export async function bufferRequest<T>(args: {
  accessToken: string;
  query: string;
  variables?: Record<string, unknown>;
  now: number;
  fetchImpl?: typeof fetch;
  endpoint?: string;
}): Promise<{ data: T; rateLimit: RateLimitSnapshot | null }> {
  const { accessToken, query, variables, now } = args;
  const doFetch = args.fetchImpl ?? fetch;
  const redact = (text: string): string =>
    accessToken ? text.split(accessToken).join("[redacted]") : text;

  let response: Response;
  try {
    response = await doFetch(args.endpoint ?? ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ query, ...(variables && { variables }) }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    // The original error is dropped on purpose: it could echo request headers.
    throw new BufferError("network failure reaching the Buffer API", {
      kind: "network",
    });
  }

  if (response.status === 429) {
    const retryAfterMs = parseRetryAfter(
      response.headers.get("retry-after"),
      now,
    );
    throw new BufferError("Buffer rate limit reached", {
      kind: "rate_limit",
      status: 429,
      ...(retryAfterMs !== undefined && { retryAfterMs }),
    });
  }
  if (response.status === 401 || response.status === 403) {
    throw new BufferError(
      `Buffer rejected the credential (HTTP ${response.status})`,
      {
        kind: "auth",
        status: response.status,
      },
    );
  }
  if (!response.ok) {
    throw new BufferError(`Buffer API returned HTTP ${response.status}`, {
      kind: "api",
      status: response.status,
    });
  }

  const body = (await response.json().catch(() => null)) as {
    data?: T;
    errors?: GraphQLError[];
  } | null;
  if (!body || typeof body !== "object") {
    throw new BufferError("malformed response from the Buffer API", {
      kind: "api",
      status: response.status,
    });
  }

  if (Array.isArray(body.errors) && body.errors.length > 0) {
    const codes = body.errors.map((e) => e.extensions?.code);
    const first = body.errors[0]?.message;
    const message = redact(
      typeof first === "string" && first ? first : "Buffer returned an error",
    );
    const kind: BufferErrorKind = codes.includes("UNAUTHENTICATED")
      ? "auth"
      : codes.some((c) => typeof c === "string" && c.includes("RATE_LIMIT"))
        ? "rate_limit"
        : "api";
    const retryAfterMs =
      kind === "rate_limit"
        ? parseRetryAfter(response.headers.get("retry-after"), now)
        : undefined;
    throw new BufferError(message, {
      kind,
      status: response.status,
      ...(retryAfterMs !== undefined && { retryAfterMs }),
    });
  }

  if (body.data === undefined || body.data === null) {
    throw new BufferError("Buffer response had no data", {
      kind: "api",
      status: response.status,
    });
  }

  return {
    data: body.data,
    rateLimit: parseRateLimit(response.headers.get("ratelimit"), now),
  };
}
