"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyGithubSignature = verifyGithubSignature;
const crypto_1 = require("crypto");
function verifyGithubSignature(payloadBody, signatureHeader, secret) {
    if (!signatureHeader || !signatureHeader.startsWith("sha256="))
        return false;
    const expected = "sha256=" + (0, crypto_1.createHmac)("sha256", secret).update(payloadBody).digest("hex");
    const expectedBuf = Buffer.from(expected, "utf8");
    const actualBuf = Buffer.from(signatureHeader, "utf8");
    if (expectedBuf.length !== actualBuf.length)
        return false;
    return (0, crypto_1.timingSafeEqual)(expectedBuf, actualBuf);
}
