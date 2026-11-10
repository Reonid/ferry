import type { RedisLike } from "./redis-like";

/** In-memory RedisLike following Upstash semantics. Expiry reads Date.now(), so Vitest fake timers drive it. */
export function createFakeRedis(): RedisLike {
  const strings = new Map<string, string>();
  const sets = new Map<string, Set<string>>();
  const zsets = new Map<string, Map<string, number>>();
  const expiresAt = new Map<string, number>();

  function exists(key: string): boolean {
    return strings.has(key) || sets.has(key) || zsets.has(key);
  }
  function remove(key: string): boolean {
    const had = exists(key);
    strings.delete(key);
    sets.delete(key);
    zsets.delete(key);
    expiresAt.delete(key);
    return had;
  }
  function purge(key: string): void {
    const expiry = expiresAt.get(key);
    if (expiry !== undefined && Date.now() >= expiry) remove(key);
  }
  function bound(value: number | string, dflt: number): number {
    if (value === "-inf") return -Infinity;
    if (value === "+inf" || value === "inf") return Infinity;
    const n = Number(value);
    return Number.isNaN(n) ? dflt : n;
  }

  return {
    async get(key) {
      purge(key);
      return strings.get(key) ?? null;
    },
    async set(key, value, opts) {
      purge(key);
      if (opts?.nx && exists(key)) return null;
      if (opts?.xx && !exists(key)) return null;
      remove(key);
      strings.set(key, value);
      if (opts?.ex !== undefined) {
        expiresAt.set(key, Date.now() + opts.ex * 1000);
      } else if (opts?.px !== undefined) {
        expiresAt.set(key, Date.now() + opts.px);
      }
      return "OK";
    },
    async del(...keys) {
      if (keys.length === 0) throw new Error("ERR wrong number of arguments");
      let n = 0;
      for (const key of keys) {
        purge(key);
        if (remove(key)) n++;
      }
      return n;
    },
    async mget(...keys) {
      if (keys.length === 0) throw new Error("ERR wrong number of arguments");
      return keys.map((key) => {
        purge(key);
        return strings.get(key) ?? null;
      });
    },
    async incr(key) {
      purge(key);
      const next = Number(strings.get(key) ?? "0") + 1;
      if (!Number.isInteger(next))
        throw new Error("ERR value is not an integer");
      strings.set(key, String(next));
      return next;
    },
    async expire(key, seconds) {
      purge(key);
      if (!exists(key)) return 0;
      expiresAt.set(key, Date.now() + seconds * 1000);
      return 1;
    },
    async sadd(key, ...members) {
      purge(key);
      const set = sets.get(key) ?? new Set<string>();
      let added = 0;
      for (const m of members) {
        if (!set.has(m)) added++;
        set.add(m);
      }
      sets.set(key, set);
      return added;
    },
    async srem(key, ...members) {
      purge(key);
      const set = sets.get(key);
      if (!set) return 0;
      let removed = 0;
      for (const m of members) if (set.delete(m)) removed++;
      if (set.size === 0) remove(key);
      return removed;
    },
    async smembers(key) {
      purge(key);
      return [...(sets.get(key) ?? [])];
    },
    async zadd(key, { score, member }) {
      purge(key);
      const zset = zsets.get(key) ?? new Map<string, number>();
      const added = zset.has(member) ? 0 : 1;
      zset.set(member, score);
      zsets.set(key, zset);
      return added;
    },
    async zrem(key, ...members) {
      purge(key);
      const zset = zsets.get(key);
      if (!zset) return 0;
      let removed = 0;
      for (const m of members) if (zset.delete(m)) removed++;
      if (zset.size === 0) remove(key);
      return removed;
    },
    async zrange(key, min, max, opts) {
      purge(key);
      if ((opts?.offset === undefined) !== (opts?.count === undefined)) {
        throw new Error("ERR offset and count must be given together");
      }
      if (opts?.byScore && opts.rev) {
        throw new Error("zrange: do not combine byScore with rev");
      }
      const sorted = [...(zsets.get(key) ?? [])].sort(
        (a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0),
      );
      if (opts?.byScore) {
        const lo = bound(min, -Infinity);
        const hi = bound(max, Infinity);
        const members = sorted
          .filter(([, score]) => score >= lo && score <= hi)
          .map(([m]) => m);
        const offset = opts.offset ?? 0;
        return opts.count === undefined
          ? members.slice(offset)
          : members.slice(offset, offset + opts.count);
      }
      const ordered = opts?.rev ? sorted.reverse() : sorted;
      const members = ordered.map(([m]) => m);
      const len = members.length;
      let start = Number(min);
      let stop = Number(max);
      if (start < 0) start = Math.max(len + start, 0);
      if (stop < 0) stop = len + stop;
      return members.slice(start, stop + 1);
    },
    async zcard(key) {
      purge(key);
      return zsets.get(key)?.size ?? 0;
    },
    async zremrangebyscore(key, min, max) {
      purge(key);
      const zset = zsets.get(key);
      if (!zset) return 0;
      const lo = bound(min, -Infinity);
      const hi = bound(max, Infinity);
      let removed = 0;
      for (const [member, score] of zset)
        if (score >= lo && score <= hi) {
          zset.delete(member);
          removed++;
        }
      if (zset.size === 0) remove(key);
      return removed;
    },
  };
}
