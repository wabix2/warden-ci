import { POPULAR_NPM_PACKAGES, POPULAR_PYPI_PACKAGES } from "./popularPackages";

export interface PopularPackageSnapshot {
  npm: string[];
  pypi: string[];
  refreshedAt: string;
  source: "live" | "redis" | "bootstrap";
}

export interface PopularPackageRefreshOptions {
  fetchImpl?: typeof fetch;
  redis?: { get<T>(key: string): Promise<T | null>; set(key: string, value: unknown, options?: { ex: number }): Promise<unknown> };
  now?: () => number;
  npmCandidates?: string[];
  pypiCandidates?: string[];
}

const SNAPSHOT_KEY = "warden:popular-packages:v1";
const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 4_000;
// Top 100 balances typosquat coverage with registry rate limits. This ranks the
// checked-in candidate pool; it is not a claim that the pool is exhaustive.
const POPULAR_PACKAGE_LIMIT = 100;
const BOOTSTRAP_NPM = [...POPULAR_NPM_PACKAGES];
// npm and PyPI expose practical download-ranking endpoints. crates.io, Go
// modules, and RubyGems do not currently have a stable equivalent used here;
// those adapters intentionally report no refresh-backed typosquat corpus.
const BOOTSTRAP_PYPI = [...POPULAR_PYPI_PACKAGES];
let refreshPromise: Promise<PopularPackageSnapshot | null> | null = null;

async function fetchJson<T>(url: string, fetchImpl: typeof fetch): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json() as T;
  } finally {
    clearTimeout(timeout);
  }
}

async function rankCandidates(candidates: string[], urlFor: (name: string) => string, fetchImpl: typeof fetch): Promise<string[]> {
  const scored: Array<{ name: string; downloads: number }> = [];
  for (const name of candidates) {
    try {
      const data = await fetchJson<{ downloads?: number; data?: { last_month?: { downloads?: number }; month?: { downloads?: number } } }>(urlFor(name), fetchImpl);
      const downloads = data.downloads ?? data.data?.last_month?.downloads ?? data.data?.month?.downloads;
      if (typeof downloads === "number" && Number.isFinite(downloads) && downloads >= 0) scored.push({ name, downloads });
    } catch (error) {
      console.warn(`Popular-package refresh skipped ${name}:`, error instanceof Error ? error.message : error);
    }
  }
  return scored.sort((a, b) => b.downloads - a.downloads).slice(0, POPULAR_PACKAGE_LIMIT).map(({ name }) => name);
}

function publish(snapshot: PopularPackageSnapshot): void {
  POPULAR_NPM_PACKAGES.splice(0, POPULAR_NPM_PACKAGES.length, ...snapshot.npm);
  POPULAR_PYPI_PACKAGES.splice(0, POPULAR_PYPI_PACKAGES.length, ...snapshot.pypi);
}

export function getBootstrapSnapshot(now = Date.now()): PopularPackageSnapshot {
  return { npm: [...BOOTSTRAP_NPM], pypi: [...BOOTSTRAP_PYPI], refreshedAt: new Date(now).toISOString(), source: "bootstrap" };
}

export async function refreshPopularPackages(options: PopularPackageRefreshOptions = {}): Promise<PopularPackageSnapshot | null> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    try {
      const fetchImpl = options.fetchImpl ?? fetch;
      const npmCandidates = options.npmCandidates ?? BOOTSTRAP_NPM;
      const pypiCandidates = options.pypiCandidates ?? BOOTSTRAP_PYPI;
      const [npm, pypi] = await Promise.all([
        rankCandidates(npmCandidates, (name) => `https://api.npmjs.org/downloads/point/last-month/${encodeURIComponent(name)}`, fetchImpl),
        rankCandidates(pypiCandidates, (name) => `https://pypistats.org/api/packages/${encodeURIComponent(name)}/recent`, fetchImpl),
      ]);
      if (npm.length === 0 || pypi.length === 0) throw new Error("refresh produced an empty ecosystem ranking");
      const snapshot: PopularPackageSnapshot = { npm, pypi, refreshedAt: new Date((options.now ?? Date.now)()).toISOString(), source: "live" };
      publish(snapshot);
      if (options.redis) await options.redis.set(SNAPSHOT_KEY, snapshot, { ex: Math.ceil(REFRESH_INTERVAL_MS / 1000) * 2 });
      return snapshot;
    } catch (error) {
      console.error("Popular-package refresh failed; retaining last-known-good arrays:", error);
      return null;
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

export async function restorePopularPackages(options: PopularPackageRefreshOptions = {}): Promise<PopularPackageSnapshot> {
  try {
    const cached = options.redis ? await options.redis.get<PopularPackageSnapshot>(SNAPSHOT_KEY) : null;
    if (cached && Array.isArray(cached.npm) && cached.npm.length > 0 && Array.isArray(cached.pypi) && cached.pypi.length > 0) {
      const snapshot = { ...cached, source: "redis" as const };
      publish(snapshot);
      return snapshot;
    }
  } catch (error) {
    console.error("Popular-package cache restore failed; using bootstrap arrays:", error);
  }
  return getBootstrapSnapshot(options.now ? options.now() : Date.now());
}

export function schedulePopularPackageRefresh(options: PopularPackageRefreshOptions = {}): () => void {
  void restorePopularPackages(options).then(() => refreshPopularPackages(options));
  const timer = setInterval(() => void refreshPopularPackages(options), REFRESH_INTERVAL_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}
