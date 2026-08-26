/**
 * Warden CI — GitHub webhook signature verification.
 *
 * GitHub signs every webhook payload with HMAC-SHA256 using the secret you
 * configured when creating the GitHub App. Verifying this is what stops
 * anyone on the internet from POSTing a fake "pull_request" event at your
 * endpoint and getting Warden to post bogus Check Runs (or worse, use it as
 * a probe against your server). This must run against the raw request body,
 * before any JSON parsing, since re-serialized JSON won't byte-match what
 * GitHub actually signed.
 */

import { createHmac, timingSafeEqual } from "crypto";

export function verifyGithubSignature(payloadBody: Buffer, signatureHeader: string | undefined, secret: string): boolean {
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) return false;

  const expected = "sha256=" + createHmac("sha256", secret).update(payloadBody).digest("hex");
  const expectedBuf = Buffer.from(expected, "utf8");
  const actualBuf = Buffer.from(signatureHeader, "utf8");

  if (expectedBuf.length !== actualBuf.length) return false;
  return timingSafeEqual(expectedBuf, actualBuf);
}
