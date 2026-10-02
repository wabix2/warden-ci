"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.corpusOptOutKeyPrefix = exports.corpusRetention = void 0;
exports.telemetryEnabled = telemetryEnabled;
exports.setInstallationCorpusOptOut = setInstallationCorpusOptOut;
exports.corpusLoggingAllowed = corpusLoggingAllowed;
exports.setPrivateCorpusOptIn = setPrivateCorpusOptIn;
exports.sanitizeCorpusInput = sanitizeCorpusInput;
exports.logCorpusEvent = logCorpusEvent;
exports.getPackageFlagCount = getPackageFlagCount;
const redis_1 = require("../lib/redis");
const MAX_EVENT_LOG = 5000;
const RAW_RETENTION_SECONDS = 90 * 24 * 60 * 60;
const AGGREGATE_RETENTION_SECONDS = 365 * 24 * 60 * 60;
const EVENTS_KEY = "warden:corpus:events";
const OPT_OUT_PREFIX = "warden:telemetry:optout:";
function telemetryEnabled() {
    return process.env.WARDEN_TELEMETRY_ENABLED !== "false";
}
function countKey(ecosystem, verdict, packageName) {
    return `warden:corpus:count:${ecosystem}:${verdict}:${packageName}`;
}
function optOutKey(installationId) {
    return `${OPT_OUT_PREFIX}${installationId}`;
}
async function setInstallationCorpusOptOut(installationId, optedOut) {
    const redis = (0, redis_1.getRedisClient)();
    if (optedOut) {
        await redis.set(optOutKey(installationId), "1");
    }
    else {
        await redis.del(optOutKey(installationId));
    }
}
/** Public-repository telemetry is on by default; private repositories require explicit opt-in. */
async function corpusLoggingAllowed(installationId, isPrivate) {
    if (!telemetryEnabled())
        return false;
    const redis = (0, redis_1.getRedisClient)();
    if (isPrivate) {
        return (await redis.get(`${OPT_OUT_PREFIX}private:${installationId}`)) === "enabled";
    }
    return (await redis.get(optOutKey(installationId))) !== "1";
}
async function setPrivateCorpusOptIn(installationId, enabled) {
    const redis = (0, redis_1.getRedisClient)();
    if (enabled)
        await redis.set(`${OPT_OUT_PREFIX}private:${installationId}`, "enabled");
    else
        await redis.del(`${OPT_OUT_PREFIX}private:${installationId}`);
}
const SAFE_PACKAGE_NAME = /^(?:@[a-z0-9._~-]+\/)?[a-z0-9._~-]+$/i;
const ALLOWED_ECOSYSTEMS = new Set(["npm", "pypi", "rust", "ruby"]);
const ALLOWED_VERDICTS = new Set(["hallucinated", "typosquat-suspect", "dependency-confusion-suspect", "maintainer-takeover-suspect", "known-malware"]);
function sanitizeCorpusInput(input) {
    if (!ALLOWED_ECOSYSTEMS.has(input.ecosystem) || !SAFE_PACKAGE_NAME.test(input.packageName) || input.packageName.length > 214 || !ALLOWED_VERDICTS.has(input.verdict)) {
        throw new Error("Invalid corpus telemetry package event");
    }
    if (input.impersonating !== undefined && (!SAFE_PACKAGE_NAME.test(input.impersonating) || input.impersonating.length > 214)) {
        throw new Error("Invalid corpus telemetry impersonating package");
    }
    const timestamp = new Date(input.timestamp);
    if (!Number.isFinite(timestamp.getTime()))
        throw new Error("Invalid corpus telemetry timestamp");
    return {
        ecosystem: input.ecosystem,
        packageName: input.packageName,
        verdict: input.verdict,
        ...(input.impersonating ? { impersonating: input.impersonating } : {}),
        timestamp: timestamp.toISOString(),
    };
}
async function logCorpusEvent(input) {
    if (!telemetryEnabled())
        return;
    const event = sanitizeCorpusInput(input);
    try {
        const redis = (0, redis_1.getRedisClient)();
        await Promise.all([
            redis.incr(countKey(event.ecosystem, event.verdict, event.packageName)),
            redis.expire(countKey(event.ecosystem, event.verdict, event.packageName), AGGREGATE_RETENTION_SECONDS),
            redis.lpush(EVENTS_KEY, JSON.stringify(event)),
            redis.ltrim(EVENTS_KEY, 0, MAX_EVENT_LOG - 1),
            redis.expire(EVENTS_KEY, RAW_RETENTION_SECONDS),
        ]);
    }
    catch (err) {
        console.error("Corpus logging failed (non-fatal):", err);
    }
}
async function getPackageFlagCount(ecosystem, verdict, packageName) {
    const redis = (0, redis_1.getRedisClient)();
    const value = await redis.get(countKey(ecosystem, verdict, packageName));
    return value ?? 0;
}
exports.corpusRetention = {
    rawEventDays: 90,
    aggregateDays: 365,
};
exports.corpusOptOutKeyPrefix = OPT_OUT_PREFIX;
