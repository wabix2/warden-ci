"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.scanFiles = scanFiles;
const path_1 = __importDefault(require("path"));
const diff_1 = require("./diff");
const secrets_1 = require("./secrets");
const dangerousExec_1 = require("./dangerousExec");
const riskSignals_1 = require("./riskSignals");
const advisories_1 = require("./advisories");
const npm_1 = require("./ecosystems/npm");
const pypi_1 = require("./ecosystems/pypi");
const rust_1 = require("./ecosystems/rust");
const ruby_1 = require("./ecosystems/ruby");
const policy_1 = require("../enforcement/policy");
const MAX_ANNOTATIONS = 50; // GitHub Check Run API accepts at most 50 annotations per request
const ECOSYSTEMS = [npm_1.npmEcosystem, pypi_1.pypiEcosystem, rust_1.rustEcosystem, ruby_1.rubyEcosystem];
function ecosystemForFile(filename) {
    const ext = path_1.default.extname(filename).toLowerCase();
    return ECOSYSTEMS.find((e) => e.extensions.includes(ext));
}
async function checkPackageRisk(ecosystem, linesByPackage) {
    const annotations = [];
    const flags = [];
    const packages = [...linesByPackage.keys()];
    // Live threat-intel pass: cross-reference every dependency against OSV's
    // malicious-package feed. A confirmed `MAL-` advisory supersedes the softer
    // metadata heuristics below — it means the invented/typo'd name is not just
    // suspicious, it is already weaponized.
    const osvEcosystem = (0, advisories_1.osvEcosystemFor)(ecosystem.id);
    const malwareByPackage = osvEcosystem
        ? await (0, advisories_1.queryMalwareAdvisories)(packages, osvEcosystem)
        : new Map();
    for (const [pkg, advisory] of malwareByPackage) {
        flags.push({ ecosystem: ecosystem.id, verdict: "known-malware", packageName: pkg });
        const summary = advisory.summary ? ` ${advisory.summary}` : "";
        const evidence = advisory.reference ? ` See ${advisory.reference} (${advisory.osvId}).` : ` Advisory ${advisory.osvId}.`;
        for (const line of linesByPackage.get(pkg)) {
            annotations.push({
                line,
                title: "Known malicious package",
                severity: "failure",
                message: `Package "${pkg}" has a confirmed malicious-package advisory on the ${ecosystem.label} registry.${summary} This is the realized form of a slopsquat/typosquat attack — an attacker registered this name and published malware under it.${evidence} Do not install or merge this dependency.`,
                category: "dependency",
                confidence: "high",
                remediation: `Remove "${pkg}", audit any machine that already installed it for compromise, and rotate secrets exposed to it.`,
                fingerprint: `dependency:${ecosystem.id}:${pkg}:malware:${advisory.osvId}`,
            });
        }
    }
    const CONCURRENCY = 8;
    for (let i = 0; i < packages.length; i += CONCURRENCY) {
        const batch = packages.slice(i, i + CONCURRENCY);
        const results = await Promise.all(batch.map((pkg) => (0, riskSignals_1.assessPackage)(pkg, ecosystem)));
        batch.forEach((pkg, idx) => {
            const verdict = results[idx];
            if (!verdict)
                return;
            // A confirmed malware advisory already spoke for this package; don't
            // dilute a hard failure with a softer, redundant heuristic finding.
            if (malwareByPackage.has(pkg))
                return;
            flags.push({ ecosystem: ecosystem.id, verdict: verdict.verdict, packageName: pkg, impersonating: verdict.impersonating, latestVersion: verdict.latestVersion, latestPublisher: verdict.latestPublisher });
            const lines = linesByPackage.get(pkg);
            for (const line of lines) {
                if (verdict.verdict === "hallucinated") {
                    annotations.push({
                        line,
                        title: "Unverified package",
                        severity: "warning",
                        message: `Package "${pkg}" was not found on the ${ecosystem.label} registry. If this was suggested by an AI tool, it may be a hallucinated package name — verify before merging, since attackers register exactly these invented names to distribute malware.`,
                        category: "dependency",
                        confidence: "high",
                        remediation: `Confirm the package name on the ${ecosystem.label} registry and pin a trusted version before merging.`,
                        fingerprint: `dependency:${ecosystem.id}:${pkg}:hallucinated`,
                    });
                }
                else if (verdict.verdict === "typosquat-suspect") {
                    annotations.push({
                        line,
                        title: "Possible typosquat package",
                        severity: "failure",
                        message: `Package "${pkg}" exists but was only published ${verdict.publishedDaysAgo} day(s) ago and is a near-exact match for the popular package "${verdict.impersonating}". This is a common pattern for typosquat/slopsquat attacks — confirm this is the package you meant before merging.`,
                        category: "dependency",
                        confidence: "high",
                        remediation: "Compare the package owner, repository, release history, and lockfile before approving this dependency.",
                        fingerprint: `dependency:${ecosystem.id}:${pkg}:typosquat:${verdict.impersonating}`,
                    });
                }
                else if (verdict.verdict === "dependency-confusion-suspect") {
                    annotations.push({
                        line,
                        title: "Possible dependency-confusion package",
                        severity: "failure",
                        message: `Package "${pkg}" has a high major version (${verdict.latestVersion}) but a thin, recent release history. Public metadata cannot prove an internal-name collision; treat this as a review signal for possible version-shadowing behavior.`,
                        category: "dependency",
                        confidence: "medium",
                        remediation: "Compare this name against your private registries and lockfile policy, then verify the publisher and intended source before merging.",
                        fingerprint: `dependency:${ecosystem.id}:${pkg}:dependency-confusion`,
                    });
                }
                else {
                    annotations.push({
                        line,
                        title: "Possible maintainer takeover",
                        severity: "failure",
                        message: `Popular npm package "${pkg}" appears to have a recent release from a different observed publisher (${verdict.latestPublisher ?? "unknown"}). Public metadata cannot prove compromise; verify the release and publisher before merging.`,
                        category: "dependency",
                        confidence: "medium",
                        remediation: "Review the release provenance, publisher account, signed artifacts, and lockfile before approving this dependency.",
                        fingerprint: `dependency:${ecosystem.id}:${pkg}:maintainer-takeover`,
                    });
                }
            }
        });
    }
    return { annotations, flags };
}
async function scanFiles(files, policy) {
    const startedAt = Date.now();
    const annotations = [];
    const packageFlags = [];
    let filesScanned = 0;
    let filesSkipped = 0;
    for (const file of files) {
        const addedLines = (0, diff_1.parseAddedLines)(file.patch);
        if (file.patch === null || file.patch === undefined) {
            filesSkipped += 1;
            continue;
        }
        if (addedLines.length === 0) {
            filesSkipped += 1;
            continue;
        }
        filesScanned += 1;
        const secrets = (0, secrets_1.checkSecrets)(addedLines);
        for (const f of secrets) {
            annotations.push({ path: file.filename, line: f.line, message: f.message, title: "Possible hardcoded secret", severity: "failure", category: "secret", confidence: "high", remediation: "Remove the credential, rotate it with the provider, and load it from a secret manager.", fingerprint: `secret:${file.filename}:${f.line}:${f.message}` });
        }
        const dangerousExec = (0, dangerousExec_1.checkDangerousExec)(addedLines);
        for (const f of dangerousExec) {
            annotations.push({ path: file.filename, line: f.line, message: f.message, title: "Dangerous dynamic execution", severity: "warning", category: "execution", confidence: "medium", remediation: "Replace dynamic execution with an allowlisted API and validate all untrusted input at the boundary.", fingerprint: `execution:${file.filename}:${f.line}:${f.message}` });
        }
        const ecosystem = ecosystemForFile(file.filename);
        if (ecosystem) {
            const linesByPackage = ecosystem.extractPackages(addedLines);
            if (linesByPackage.size > 0) {
                const { annotations: pkgAnnotations, flags } = await checkPackageRisk(ecosystem, linesByPackage);
                for (const a of pkgAnnotations) {
                    annotations.push({ ...a, path: file.filename, packageName: a.fingerprint.split(":")[2] || undefined, ecosystem: ecosystem.id, manifestPath: ecosystem.id === "npm" ? "package.json" : ecosystem.id === "pypi" ? "requirements.txt" : undefined });
                }
                packageFlags.push(...flags);
            }
        }
    }
    if (annotations.length > MAX_ANNOTATIONS) {
        annotations.length = MAX_ANNOTATIONS;
    }
    const policyDecision = (0, policy_1.evaluateGate)(annotations, policy);
    const incomplete = filesSkipped > 0;
    const verdict = policyDecision.shouldBlock ? "fail" : incomplete && (policy?.failOnIncomplete ?? false) ? "incomplete" : "pass";
    return { annotations, packageFlags, filesScanned, filesSkipped, policyDecision, verdict, durationMs: Date.now() - startedAt };
}
