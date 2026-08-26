/**
 * Warden CI — detection corpus logging.
 *
 * This is the actual point-1 asset: a running record of which package names
 * get flagged as hallucinated or typosquat-suspect, across every install,
 * over time. A competitor starting today has zero of this history; it's the
 * one thing here that gets harder to replicate the longer the product runs,
 * rather than easier.
 *
 * PRIVACY DESIGN — deliberate, not incidental:
 *  - We log the package name, ecosystem, verdict, and an installation ID.
 *  - We never log repo names, file paths, file contents, org/user logins, or
 *    anything else about the customer's code. The corpus is "which package
 *    names get flagged," not "who flagged them."
 *  - The installation ID is stored so we can dedupe repeated flags from the
 *    same installer without needing to know who they are — it's an opaque
 *    GitHub installation ID, not tied to a login in this table.
 *
 * DISABLED BY DEFAULT. Turning this on is a legal/product decision, not an
 * engineering one: PRIVACY.md must actually disclose this before it's
 * switched on for real customers (see the TODO left in PRIVACY.md). Flip
 * WARDEN_TELEMETRY_ENABLED=true only after that's done.
 */

import { getRedisClient } from "../lib/redis";
import { Verdict } from "../scan/riskSignals";

export interface CorpusEvent {
  ecosystem: string;
  packageName: string;
  verdict: Verdict;
  impersonating?: string;
  installationId: number;
  timestamp: string;
}

const MAX_EVENT_LOG = 5000; // bounds storage cost; counts below are the durable aggregate, this list is a recent-activity sample

export function telemetryEnabled(): boolean {
  return process.env.WARDEN_TELEMETRY_ENABLED === "true";
}

function countKey(ecosystem: string, verdict: Verdict, packageName: string): string {
  return `warden:corpus:count:${ecosystem}:${verdict}:${packageName}`;
}

export async function logCorpusEvent(event: CorpusEvent): Promise<void> {
  if (!telemetryEnabled()) return;

  try {
    const redis = getRedisClient();
    await Promise.all([
      redis.incr(countKey(event.ecosystem, event.verdict, event.packageName)),
      redis.lpush("warden:corpus:events", JSON.stringify(event)),
      redis.ltrim("warden:corpus:events", 0, MAX_EVENT_LOG - 1),
    ]);
  } catch (err) {
    // Telemetry must never break scanning — log and move on.
    console.error("Corpus logging failed (non-fatal):", err);
  }
}

/** How many times a specific package has been flagged, across all installs, for a given verdict. Useful once you want to answer "is this a one-off or a pattern?" */
export async function getPackageFlagCount(ecosystem: string, verdict: Verdict, packageName: string): Promise<number> {
  const redis = getRedisClient();
  const value = await redis.get<number>(countKey(ecosystem, verdict, packageName));
  return value ?? 0;
}
