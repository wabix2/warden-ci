"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRedisClient = getRedisClient;
const redis_1 = require("@upstash/redis");
let client = null;
function getRedisClient() {
    if (!client) {
        // .trim() guards against a copy-pasted env var picking up a trailing space or
        // newline — invisible in most dashboards, but breaks Upstash's auth check silently.
        const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
        const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
        if (!url || !token) {
            throw new Error("UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN is not set (or empty after trimming)");
        }
        client = new redis_1.Redis({ url, token });
    }
    return client;
}
