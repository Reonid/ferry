import { Redis } from "@upstash/redis";
import { env } from "@/lib/env";
import { loadKey } from "@/lib/crypto";
import { createFakeRedis } from "./fake-redis";
import type { RedisLike } from "./redis-like";
import { createStore, type Store } from "./store";

export type { RedisLike } from "./redis-like";
export { createFakeRedis } from "./fake-redis";
export { createStore, type Store } from "./store";

const globalForFake = globalThis as { __ferryFakeRedis?: RedisLike };
let warned = false;

export function getStore(): Store {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  const key = loadKey(env("ENCRYPTION_KEY"));

  if (url && token) {
    const redis = new Redis({ url, token, automaticDeserialization: false });
    return createStore(redis as unknown as RedisLike, key);
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Redis is not configured: set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN",
    );
  }
  if (!warned) {
    warned = true;
    console.warn(
      "Ferry: no Redis configured, using in-memory store (dev only).",
    );
  }
  globalForFake.__ferryFakeRedis ??= createFakeRedis();
  return createStore(globalForFake.__ferryFakeRedis, key);
}
