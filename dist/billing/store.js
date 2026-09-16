"use strict";
/**
 * Warden CI — persistent billing store (Upstash Redis).
 *
 * Replaces the in-memory `activeProUsers` Set that used to live in server.ts directly.
 * That Set reset to empty every time Render restarted the process — which happens
 * automatically whenever the free-tier instance spins down from inactivity — silently
 * revoking every paying customer's access until they happened to trigger a new scan.
 * This store survives restarts, since the data lives in Redis, not process memory.
 *
 * Keyed by GitHub owner login (lowercased) to match how the rest of server.ts already
 * identifies accounts, rather than installation ID — simplest fix with the least
 * disruption to the current architecture.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.setProStatus = setProStatus;
exports.getOwnerForSale = getOwnerForSale;
exports.getProRecord = getProRecord;
exports.isProActive = isProActive;
exports.addToWaitlist = addToWaitlist;
exports.getWaitlist = getWaitlist;
const redis_1 = require("../lib/redis");
function getClient() {
    return (0, redis_1.getRedisClient)();
}
function ownerKey(owner) {
    return `warden:pro:${owner.toLowerCase()}`;
}
function saleKey(saleId) {
    return `warden:sale:${saleId}`;
}
async function setProStatus(record) {
    const redis = getClient();
    await redis.set(ownerKey(record.owner), record);
    if (record.gumroadSaleId) {
        await redis.set(saleKey(record.gumroadSaleId), record.owner);
    }
    if (record.gumroadSubscriptionId) {
        await redis.set(`warden:subscription:${record.gumroadSubscriptionId}`, record.owner);
    }
}
async function getOwnerForSale(saleId) {
    const redis = getClient();
    const owner = await redis.get(saleKey(saleId));
    return owner ?? null;
}
async function getProRecord(owner) {
    const redis = getClient();
    const data = await redis.get(ownerKey(owner));
    return data ?? null;
}
async function isProActive(owner) {
    const record = await getProRecord(owner);
    if (!record)
        return false;
    if (record.status !== "active" && record.status !== "trialing")
        return false;
    if (record.updatedAt && Date.now() - Date.parse(record.updatedAt) > 1000 * 60 * 60 * 24 * 45)
        return false;
    return record.plan === "pro" || record.plan === "team" || record.plan === "enterprise";
}
const WAITLIST_KEY = "warden:waitlist";
async function addToWaitlist(entry) {
    const redis = getClient();
    // A Redis hash keyed by email — resubmitting the same email updates their entry
    // (e.g. picks a different plan) instead of creating duplicates.
    await redis.hset(WAITLIST_KEY, { [entry.email.toLowerCase()]: JSON.stringify(entry) });
}
async function getWaitlist() {
    const redis = getClient();
    const all = await redis.hgetall(WAITLIST_KEY);
    if (!all)
        return [];
    return Object.values(all).map((raw) => JSON.parse(raw));
}
