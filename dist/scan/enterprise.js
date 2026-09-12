"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.defaultScanPolicy = void 0;
exports.fingerprintFinding = fingerprintFinding;
exports.evaluatePolicy = evaluatePolicy;
exports.toSarif = toSarif;
exports.toCycloneDx = toCycloneDx;
exports.redact = redact;
const node_crypto_1 = require("node:crypto");
exports.defaultScanPolicy = {
    mode: "block",
    minimumSeverity: "failure",
    blockCategories: ["secret", "execution", "dependency"],
    failOnIncomplete: true,
};
const severityRank = { warning: 1, failure: 2 };
function fingerprintFinding(input) {
    return (0, node_crypto_1.createHash)("sha256")
        .update([input.category, input.path, input.line, input.title, input.message].join("\0"))
        .digest("hex")
        .slice(0, 32);
}
function evaluatePolicy(result, policy = exports.defaultScanPolicy) {
    const blocking = result.annotations.filter((finding) => policy.mode === "block" &&
        policy.blockCategories.includes(finding.category) &&
        severityRank[finding.severity] >= severityRank[policy.minimumSeverity]);
    const incomplete = result.verdict === "incomplete";
    return {
        verdict: blocking.length > 0 || (incomplete && policy.failOnIncomplete) ? "fail" : "pass",
        blocking,
        incomplete,
        reason: incomplete ? "The scan did not inspect every changed file." : blocking.length ? `${blocking.length} policy violation(s) require remediation.` : "No blocking policy violations found.",
    };
}
function toSarif(result, toolVersion = "1.0.0") {
    return {
        version: "2.1.0",
        $schema: "https://json.schemastore.org/sarif-2.1.0.json",
        runs: [{
                tool: { driver: { name: "Warden CI", version: toolVersion, informationUri: "https://warden-ci.dev" } },
                results: result.annotations.map((finding) => ({
                    ruleId: finding.fingerprint,
                    level: finding.severity === "failure" ? "error" : "warning",
                    message: { text: finding.message },
                    locations: [{ physicalLocation: { artifactLocation: { uri: finding.path }, region: { startLine: finding.line } } }],
                    fixes: [{ description: { text: finding.remediation } }],
                })),
            }],
    };
}
function toCycloneDx(result) {
    return {
        bomFormat: "CycloneDX",
        specVersion: "1.5",
        version: 1,
        metadata: { tools: [{ vendor: "Warden CI", name: "Warden scanner", version: "1.0.0" }] },
        components: result.packageFlags.map((flag) => ({ type: "library", name: flag.packageName, scope: "required", properties: [{ name: "warden:ecosystem", value: flag.ecosystem }, { name: "warden:risk", value: flag.verdict }] })),
    };
}
function redact(value) {
    return value.replace(/(sk-(?:proj|admin|live)-|sk-ant-|npm_|SG\.)[A-Za-z0-9_.-]+/g, "$1[REDACTED]");
}
