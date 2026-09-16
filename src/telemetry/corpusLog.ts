import { getRedisClient } from "../lib/redis";
import { Verdict } from "../scan/riskSignals";

/**
 * Detection corpus events are deliberately a narrow, sanitized package signal.
 * Repository, organization, installation and code data never enter this type.
 * Raw events expire after 90 days; per-package aggregates expire after 365 days.
 */
export interface CorpusEvent {
  ecosystem: string;
  packageName: string;
  verdict: Verdict;
  impersonating?: string;
  timestamp: string;
}

export interface CorpusTelemetryInput {
  ecosystem: string;
  packageName: string;
  verdict: Verdict;
  impersonating?: string;
  timestamp: string;
}

const MAX_EVENT_LOG = 5000;
const RAW_RETENTION_SECONDS = 90 * 24 * 60 * 60;
const AGGREGATE_RETENTION_SECONDS = 365 * 24 * 60 * 60;
const EVENTS_KEY = "warden:corpus:events";
const OPT_OUT_PREFIX = "warden:telemetry:optout:";

export function telemetryEnabled(): boolean {
  return process.env.WARDEN_TELEMETRY_ENABLED !== "false";
}

function countKey(ecosystem: string, verdict: Verdict, packageName: string): string {
  return `warden:corpus:count:${ecosystem}:${verdict}:${packageName}`;
}

function optOutKey(installationId: number): string {
  return `${OPT_OUT_PREFIX}${installationId}`;
}

export async function setInstallationCorpusOptOut(installationId: number, optedOut: boolean): Promise<void> {
  const redis = getRedisClient();
  if (optedOut) {
    await redis.set(optOutKey(installationId), "1");
  } else {
    await redis.del(optOutKey(installationId));
  }
}

/** Public-repository telemetry is on by default; private repositories require explicit opt-in. */
export async function corpusLoggingAllowed(installationId: number, isPrivate: boolean): Promise<boolean> {
  if (!telemetryEnabled()) return false;
  const redis = getRedisClient();
  if (isPrivate) {
    return (await redis.get<string>(`${OPT_OUT_PREFIX}private:${installationId}`)) === "enabled";
  }
  return (await redis.get<string>(optOutKey(installationId))) !== "1";
}

export async function setPrivateCorpusOptIn(installationId: number, enabled: boolean): Promise<void> {
  const redis = getRedisClient();
  if (enabled) await redis.set(`${OPT_OUT_PREFIX}private:${installationId}`, "enabled");
  else await redis.del(`${OPT_OUT_PREFIX}private:${installationId}`);
}

const SAFE_PACKAGE_NAME = /^(?:@[a-z0-9._~-]+\/)?[a-z0-9._~-]+$/i;
const ALLOWED_ECOSYSTEMS = new Set(["npm", "pypi", "rust", "ruby"]);
const ALLOWED_VERDICTS = new Set<Verdict>(["hallucinated", "typosquat-suspect", "dependency-confusion-suspect", "maintainer-takeover-suspect", "known-malware"]);

export function sanitizeCorpusInput(input: CorpusTelemetryInput): CorpusEvent {
  if (!ALLOWED_ECOSYSTEMS.has(input.ecosystem) || !SAFE_PACKAGE_NAME.test(input.packageName) || input.packageName.length > 214 || !ALLOWED_VERDICTS.has(input.verdict)) {
    throw new Error("Invalid corpus telemetry package event");
  }
  if (input.impersonating !== undefined && (!SAFE_PACKAGE_NAME.test(input.impersonating) || input.impersonating.length > 214)) {
    throw new Error("Invalid corpus telemetry impersonating package");
  }
  const timestamp = new Date(input.timestamp);
  if (!Number.isFinite(timestamp.getTime())) throw new Error("Invalid corpus telemetry timestamp");
  return {
    ecosystem: input.ecosystem,
    packageName: input.packageName,
    verdict: input.verdict,
    ...(input.impersonating ? { impersonating: input.impersonating } : {}),
    timestamp: timestamp.toISOString(),
  };
}


export async function logCorpusEvent(input: CorpusTelemetryInput): Promise<void> {
  if (!telemetryEnabled()) return;
  const event = sanitizeCorpusInput(input);
  try {
    const redis = getRedisClient();
    await Promise.all([
      redis.incr(countKey(event.ecosystem, event.verdict, event.packageName)),
      redis.expire(countKey(event.ecosystem, event.verdict, event.packageName), AGGREGATE_RETENTION_SECONDS),
      redis.lpush(EVENTS_KEY, JSON.stringify(event)),
      redis.ltrim(EVENTS_KEY, 0, MAX_EVENT_LOG - 1),
      redis.expire(EVENTS_KEY, RAW_RETENTION_SECONDS),
    ]);
  } catch (err) {
    console.error("Corpus logging failed (non-fatal):", err);
  }
}

export async function getPackageFlagCount(ecosystem: string, verdict: Verdict, packageName: string): Promise<number> {
  const redis = getRedisClient();
  const value = await redis.get<number>(countKey(ecosystem, verdict, packageName));
  return value ?? 0;
}

export const corpusRetention = {
  rawEventDays: 90,
  aggregateDays: 365,
} as const;

export const corpusOptOutKeyPrefix = OPT_OUT_PREFIX;
