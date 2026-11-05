/**
 * The slice of @upstash/redis the store uses. The real client is built with
 * `automaticDeserialization: false`, so every value is a raw string and the
 * store JSON-encodes records itself.
 */
export interface RedisLike {
  get(key: string): Promise<string | null>;
  /** Resolves "OK" when written, null when `nx` found the key present. `ex` is seconds, `px` milliseconds. */
  set(
    key: string,
    value: string,
    opts?: { nx?: boolean; ex?: number; px?: number },
  ): Promise<"OK" | null>;
  /** Real Redis rejects zero keys; callers guard empty arrays. */
  del(...keys: string[]): Promise<number>;
  /** Real Redis rejects zero keys; callers guard empty arrays. */
  mget(...keys: string[]): Promise<(string | null)[]>;
  incr(key: string): Promise<number>;
  /** Seconds. */
  expire(key: string, seconds: number): Promise<number>;
  sadd(key: string, ...members: string[]): Promise<number>;
  srem(key: string, ...members: string[]): Promise<number>;
  smembers(key: string): Promise<string[]>;
  zadd(key: string, entry: { score: number; member: string }): Promise<number>;
  zrem(key: string, ...members: string[]): Promise<number>;
  /**
   * Index range by default (use `rev` for newest-first). With `byScore`,
   * min/max are scores and `offset`/`count` must be given together. Do not
   * combine `byScore` with `rev`: real Redis swaps the bound order.
   */
  zrange(
    key: string,
    min: number | string,
    max: number | string,
    opts?: {
      byScore?: boolean;
      rev?: boolean;
      offset?: number;
      count?: number;
    },
  ): Promise<string[]>;
  zcard(key: string): Promise<number>;
}
