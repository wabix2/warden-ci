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

import { getRedisClient } from "../lib/redis";

function getClient() {
  return getRedisClient();
}

function ownerKey(owner: string): string {
  return `warden:pro:${owner.toLowerCase()}`;
}

function saleKey(saleId: string): string {
  return `warden:sale:${saleId}`;
}

export interface ProRecord {
  owner: string;
  plan: string; // "pro" | "team" | "enterprise"
  gumroadProductId?: string;
  gumroadSaleId?: string;
  gumroadSubscriptionId?: string;
  status: "active" | "trialing" | "canceled" | "refunded" | "paused";
  refundedAt?: string;
  canceledAt?: string;
  updatedAt: string;
}

export async function setProStatus(record: ProRecord): Promise<void> {
  const redis = getClient();
  await redis.set(ownerKey(record.owner), record);
  if (record.gumroadSaleId) {
    await redis.set(saleKey(record.gumroadSaleId), record.owner);
  }
  if (record.gumroadSubscriptionId) {
    await redis.set(`warden:subscription:${record.gumroadSubscriptionId}`, record.owner);
  }
}

export async function getOwnerForSale(saleId: string): Promise<string | null> {
  const redis = getClient();
  const owner = await redis.get<string>(saleKey(saleId));
  return owner ?? null;
}

export async function getProRecord(owner: string): Promise<ProRecord | null> {
  const redis = getClient();
  const data = await redis.get<ProRecord>(ownerKey(owner));
  return data ?? null;
}

export async function isProActive(owner: string): Promise<boolean> {
  const record = await getProRecord(owner);
  if (!record) return false;
  if (record.status !== "active" && record.status !== "trialing") return false;
  if (record.updatedAt && Date.now() - Date.parse(record.updatedAt) > 1000 * 60 * 60 * 24 * 45) return false;
  return record.plan === "pro" || record.plan === "team" || record.plan === "enterprise";
}

// --- Waitlist (used while GUMROAD_CHECKOUT_ENABLED=false, e.g. during product setup) ---

export interface WaitlistEntry {
  email: string;
  plan: string;
  owner: string;
  addedAt: string;
}

const WAITLIST_KEY = "warden:waitlist";

export async function addToWaitlist(entry: WaitlistEntry): Promise<void> {
  const redis = getClient();
  // A Redis hash keyed by email — resubmitting the same email updates their entry
  // (e.g. picks a different plan) instead of creating duplicates.
  await redis.hset(WAITLIST_KEY, { [entry.email.toLowerCase()]: JSON.stringify(entry) });
}

export async function getWaitlist(): Promise<WaitlistEntry[]> {
  const redis = getClient();
  const all = await redis.hgetall<Record<string, string>>(WAITLIST_KEY);
  if (!all) return [];
  return Object.values(all as Record<string, string>).map((raw) => JSON.parse(raw) as WaitlistEntry);
}
