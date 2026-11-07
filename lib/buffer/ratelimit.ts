import type { RateLimitSnapshot, RateWindow } from "@/lib/types";

/** Splits on commas that are not inside double quotes. */
function splitOutsideQuotes(input: string, sep: string): string[] {
  const parts: string[] = [];
  let current = "";
  let inQuotes = false;
  for (const ch of input) {
    if (ch === '"') inQuotes = !inQuotes;
    if (ch === sep && !inQuotes) {
      parts.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  parts.push(current);
  return parts;
}

interface Item {
  name: string | null;
  remaining?: number;
  reset?: number;
}

function parseItem(raw: string): Item {
  const item: Item = { name: null };
  const segments = splitOutsideQuotes(raw, ";");
  segments.forEach((segment, index) => {
    const text = segment.trim();
    if (index === 0 && text.startsWith('"') && text.endsWith('"')) {
      item.name = text.slice(1, -1);
      return;
    }
    const eq = text.indexOf("=");
    if (eq < 0) return;
    const key = text.slice(0, eq).trim().toLowerCase();
    const value = Number(text.slice(eq + 1).trim());
    if (!Number.isFinite(value) || value < 0) return;
    if (key === "r" || key === "remaining") item.remaining = value;
    if (key === "t" || key === "reset") item.reset = value;
  });
  return item;
}

/** Reads Buffer's RateLimit header into windows. Null when nothing usable is in it. */
export function parseRateLimit(
  header: string | null,
  observedAt: number,
): RateLimitSnapshot | null {
  if (!header || !header.trim()) return null;
  const items = splitOutsideQuotes(header, ",")
    .map((raw) => parseItem(raw))
    .filter((i) => i.remaining !== undefined || i.reset !== undefined);

  const complete = items.filter(
    (i) => i.remaining !== undefined && i.reset !== undefined,
  );
  let windows: RateWindow[];
  if (complete.length > 0) {
    windows = complete.map((i) => ({
      name: i.name ?? "default",
      remaining: i.remaining as number,
      resetSeconds: i.reset as number,
    }));
  } else {
    const remaining = items.find((i) => i.remaining !== undefined)?.remaining;
    const reset = items.find((i) => i.reset !== undefined)?.reset;
    if (remaining === undefined || reset === undefined) return null;
    windows = [{ name: "default", remaining, resetSeconds: reset }];
  }
  return { observedAt, windows };
}
