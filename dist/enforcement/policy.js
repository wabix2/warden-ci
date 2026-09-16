"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_POLICY = void 0;
exports.validatePolicy = validatePolicy;
exports.mergePolicy = mergePolicy;
exports.evaluateGate = evaluateGate;
exports.canonicalPolicy = canonicalPolicy;
exports.signPolicy = signPolicy;
exports.verifyPolicySignature = verifyPolicySignature;
exports.policyAuditEvent = policyAuditEvent;
exports.policyToSarif = policyToSarif;
exports.policyToCycloneDx = policyToCycloneDx;
const node_crypto_1 = require("node:crypto");
exports.DEFAULT_POLICY = {
    schema: "v1",
    mode: "report",
    minimumSeverity: "failure",
    failOnIncomplete: false,
    blockCategories: ["secret", "execution", "dependency"],
    ignoredPaths: ["**/fixtures/**", "**/vendor/**"],
    ignoredPackages: [],
    requireCleanBaseline: false,
    suppressions: [],
    revision: 1,
};
const categories = new Set(["secret", "execution", "dependency"]);
const severities = new Set(["warning", "failure"]);
function globToRegExp(glob) {
    const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "§§").replace(/\*/g, "[^/]*").replace(/§§/g, ".*");
    return new RegExp(`^${escaped}$`);
}
function matchesAny(value, patterns) {
    return patterns.some((pattern) => {
        try {
            return globToRegExp(pattern).test(value);
        }
        catch {
            return false;
        }
    });
}
function validatePolicy(input, inherited = exports.DEFAULT_POLICY) {
    if (!input || typeof input !== "object")
        throw new Error("Policy must be an object");
    const source = input;
    const schema = source.schema ?? (source.version === 1 ? "v1" : inherited.schema);
    if (schema !== "v1")
        throw new Error("Unsupported policy schema; expected v1");
    const merged = { ...inherited, ...source, schema: "v1" };
    if (!new Set(["block", "report"]).has(merged.mode))
        throw new Error("Policy mode must be block or report");
    if (!severities.has(merged.minimumSeverity))
        throw new Error("Policy minimumSeverity is invalid");
    if (!Array.isArray(merged.blockCategories) || merged.blockCategories.some((category) => !categories.has(category)))
        throw new Error("Policy blockCategories is invalid");
    for (const field of ["ignoredPaths", "ignoredPackages", "suppressions"])
        if (!Array.isArray(merged[field]))
            throw new Error(`Policy ${field} must be an array`);
    for (const suppression of merged.suppressions) {
        if (!suppression.id || !suppression.reason || !suppression.owner || !suppression.expiresAt || Number.isNaN(Date.parse(suppression.expiresAt)))
            throw new Error(`Invalid suppression ${suppression.id || "unknown"}`);
    }
    return { ...merged, revision: Number.isInteger(merged.revision) && merged.revision > 0 ? merged.revision : inherited.revision };
}
function mergePolicy(parent, child) {
    const childPolicy = validatePolicy(child, parent);
    return validatePolicy({ ...childPolicy, inheritedFrom: `revision:${parent.revision}`, revision: parent.revision + 1 });
}
function evaluateGate(annotations, policyInput = {}) {
    const policy = validatePolicy({ ...exports.DEFAULT_POLICY, ...policyInput });
    const now = Date.now();
    const suppressed = [];
    const ignored = [];
    const blocking = [];
    const reasons = [];
    for (const annotation of annotations) {
        if (matchesAny(annotation.path, policy.ignoredPaths) || (annotation.packageName && policy.ignoredPackages.includes(annotation.packageName))) {
            ignored.push(annotation);
            continue;
        }
        const suppression = policy.suppressions.find((item) => (!item.expiresAt || Date.parse(item.expiresAt) >= now) && (!item.fingerprint || item.fingerprint === annotation.fingerprint) && (!item.category || item.category === annotation.category));
        if (suppression) {
            suppressed.push(annotation);
            continue;
        }
        if (policy.blockCategories.includes(annotation.category) && (annotation.severity === policy.minimumSeverity || policy.minimumSeverity === "warning"))
            blocking.push(annotation);
    }
    if (blocking.length)
        reasons.push(`${blocking.length} finding(s) match blocking policy categories and severity threshold`);
    const incomplete = policy.failOnIncomplete && annotations.length === 0;
    if (incomplete)
        reasons.push("Scan incomplete and failOnIncomplete is enabled");
    return { policy, blocking, suppressed, ignored, shouldBlock: policy.mode === "block" && (blocking.length > 0 || incomplete), verdict: incomplete ? "incomplete" : blocking.length > 0 ? "failure" : "success", reasons };
}
function canonicalPolicy(policy) {
    return JSON.stringify({ ...policy, signature: undefined });
}
function signPolicy(policy, secret, signedBy, signedAt = new Date().toISOString()) {
    if (!secret)
        throw new Error("Policy signing secret is required");
    const payload = `${signedAt}.${signedBy}.${canonicalPolicy(policy)}`;
    const signature = (0, node_crypto_1.createHmac)("sha256", secret).update(payload).digest("hex");
    return { policy: { ...policy, signature }, signedAt, signedBy, signature };
}
function verifyPolicySignature(envelope, secret) {
    if (!secret || !envelope.signature)
        return false;
    const payload = `${envelope.signedAt}.${envelope.signedBy}.${canonicalPolicy(envelope.policy)}`;
    const expected = (0, node_crypto_1.createHmac)("sha256", secret).update(payload).digest("hex");
    return expected.length === envelope.signature.length && (0, node_crypto_1.timingSafeEqual)(Buffer.from(expected), Buffer.from(envelope.signature));
}
function policyAuditEvent(policy, actor, action) {
    return { type: "policy.audit", action, actor, revision: policy.revision, schema: policy.schema, mode: policy.mode, createdAt: new Date().toISOString(), policyDigest: (0, node_crypto_1.createHmac)("sha256", "warden-policy-digest").update(canonicalPolicy(policy)).digest("hex") };
}
function policyToSarif(decision) {
    return { version: "2.1.0", $schema: "https://json.schemastore.org/sarif-2.1.0.json", runs: [{ tool: { driver: { name: "Warden CI", informationUri: "https://warden-ci-dvk5.onrender.com" } }, results: decision.blocking.map((item) => ({ ruleId: item.fingerprint, level: item.severity === "failure" ? "error" : "warning", message: { text: item.message }, locations: [{ physicalLocation: { artifactLocation: { uri: item.path }, region: { startLine: item.line } } }] })) }] };
}
function policyToCycloneDx(annotations) {
    return { bomFormat: "CycloneDX", specVersion: "1.5", version: 1, metadata: { timestamp: new Date().toISOString(), tools: [{ vendor: "Warden", name: "Warden CI" }] }, vulnerabilities: annotations.filter((item) => item.category === "dependency").map((item) => ({ id: item.fingerprint, source: { name: item.ecosystem || "unknown" }, ratings: [{ severity: item.severity === "failure" ? "high" : "medium" }], description: item.message })) };
}
