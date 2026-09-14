/**
 * Single source of truth for Warden's own public URL.
 *
 * Why this exists: two different env var names (WARDEN_PUBLIC_URL,
 * PUBLIC_BASE_URL) were being read inconsistently across the codebase.
 * server.ts validated and fell back correctly; webhookHandler.ts and the
 * remediation report-link builder read process.env.PUBLIC_BASE_URL
 * directly with no fallback, so if only WARDEN_PUBLIC_URL was set in the
 * deployment, those two spots silently produced an empty string, turning
 * "https://warden-ci-dvk5.onrender.com/details?runId=..." into a bare
 * "/details?runId=...", which GitHub resolves relative to whatever page
 * the link was posted on (a PR Check Run) instead of the Warden domain —
 * a 404 on GitHub, not on Warden.
 *
 * Every place that builds a link back to Warden should import
 * CANONICAL_BASE_URL from here instead of reading the env vars directly.
 */

const DEFAULT_PUBLIC_ORIGIN = "https://warden-ci-dvk5.onrender.com";

function trustedPublicOrigin(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return DEFAULT_PUBLIC_ORIGIN;
    if (url.hostname !== "warden-ci-dvk5.onrender.com") return DEFAULT_PUBLIC_ORIGIN;
    return url.origin;
  } catch {
    return DEFAULT_PUBLIC_ORIGIN;
  }
}

const CONFIGURED_PUBLIC_ORIGIN = (process.env.WARDEN_PUBLIC_URL || process.env.PUBLIC_BASE_URL || "")
  .trim()
  .replace(/\/$/, "");

export const CANONICAL_BASE_URL = trustedPublicOrigin(CONFIGURED_PUBLIC_ORIGIN || DEFAULT_PUBLIC_ORIGIN);
