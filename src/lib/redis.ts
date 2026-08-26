import { Redis } from "@upstash/redis";

let client: Redis | null = null;

export function getRedisClient(): Redis {
  if (!client) {
    // .trim() guards against a copy-pasted env var picking up a trailing space or
    // newline — invisible in most dashboards, but breaks Upstash's auth check silently.
    const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
    const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
    if (!url || !token) {
      throw new Error("UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN is not set (or empty after trimming)");
    }
    client = new Redis({ url, token });
  }
  return client;
}
