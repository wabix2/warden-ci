import { getRedisClient } from "../../lib/redis";
import type { Ecosystem, PackageMetadata } from "./types";

export function unavailableMetadata(): PackageMetadata {
  return { existsOnRegistry: false, lookupStatus: "unavailable" };
}

export function metadataFromResponse(status: number): PackageMetadata | null {
  if (status === 404) return { existsOnRegistry: false, lookupStatus: "not_found" };
  if (status < 200 || status >= 300) return unavailableMetadata();
  return null;
}

const CACHE_TTL_SECONDS = 15 * 60;
const memory = new Map<string, { expiresAt: number; value: PackageMetadata }>();

export async function cachedMetadata(ecosystem: Ecosystem, packageName: string, loader: () => Promise<PackageMetadata>): Promise<PackageMetadata> {
  const key = `warden:registry:${ecosystem.id}:${packageName}`;
  const local = memory.get(key);
  if (local && local.expiresAt > Date.now()) return local.value;
  try {
    const redis = getRedisClient();
    const cached = await redis.get<PackageMetadata>(key);
    if (cached?.lookupStatus) {
      memory.set(key, { expiresAt: Date.now() + CACHE_TTL_SECONDS * 1000, value: cached });
      return cached;
    }
  } catch {
    // Redis is optional for local development; the bounded in-process cache remains active.
  }
  const value = await loader();
  memory.set(key, { expiresAt: Date.now() + CACHE_TTL_SECONDS * 1000, value });
  try { await getRedisClient().set(key, value, { ex: CACHE_TTL_SECONDS }); } catch { /* optional cache */ }
  return value;
}

export function resetMetadataCacheForTests(): void { memory.clear(); }
