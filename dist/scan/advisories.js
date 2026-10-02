"use strict";
/**
 * Warden CI — live malicious-package cross-reference.
 *
 * The metadata signals in riskSignals.ts catch a package that is *not yet* on the
 * registry (a raw hallucination) or one that merely *looks* suspicious. They do not
 * catch the case that actually gets developers owned: an attacker has already
 * registered the invented / typo'd name and published real malware under it. That is
 * "slopsquatting realized", and by the time the package exists on the registry the
 * metadata heuristics go quiet.
 *
 * OSV.dev aggregates the OpenSSF malicious-packages dataset — confirmed-malicious
 * advisories carrying a `MAL-` id — alongside ordinary CVE/GHSA vulnerabilities, for
 * npm, PyPI, crates.io, and RubyGems. We batch-query it for every dependency a PR
 * introduces and surface any package with a `MAL-` advisory as a hard finding.
 *
 * We deliberately key only on `MAL-` advisories here, not general CVEs: a source-diff
 * `import x` carries no resolved version, so version-scoped vulnerability matching
 * would be noisy and misleading. A malicious-package advisory, by contrast, condemns
 * the package as a whole — it is a near-zero-false-positive, high-severity signal that
 * is exactly aligned with the AI-slop threat model. Version-scoped CVE gating belongs
 * in the lockfile-aware remediation path (see src/remediation/osv.ts), not here.
 *
 * Network failures fail OPEN (return no advisories), consistent with the rest of the
 * scan engine: an OSV outage must never turn a passing PR into a blocked one.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.osvEcosystemFor = osvEcosystemFor;
exports.queryMalwareAdvisories = queryMalwareAdvisories;
const OSV_BATCH_URL = "https://api.osv.dev/v1/querybatch";
const OSV_VULN_URL = "https://api.osv.dev/v1/vulns";
const REQUEST_TIMEOUT_MS = 5_000;
/** Maps a Warden ecosystem id to the exact ecosystem string OSV expects. */
const OSV_ECOSYSTEM = {
    npm: "npm",
    pypi: "PyPI",
    "crates.io": "crates.io",
    "rubygems.org": "RubyGems",
};
function osvEcosystemFor(ecosystemId) {
    return OSV_ECOSYSTEM[ecosystemId];
}
async function fetchWithTimeout(url, init, fetchImpl) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
        return await fetchImpl(url, { ...init, signal: controller.signal });
    }
    finally {
        clearTimeout(timeout);
    }
}
function isMalwareId(id) {
    return typeof id === "string" && id.startsWith("MAL-");
}
/** Best-effort enrichment for a single MAL advisory; degrades to id-only on any error. */
async function fetchMalwareDetail(osvId, fetchImpl) {
    try {
        const res = await fetchWithTimeout(`${OSV_VULN_URL}/${encodeURIComponent(osvId)}`, undefined, fetchImpl);
        if (!res.ok)
            return { osvId };
        const detail = (await res.json());
        const reference = detail.references?.find((r) => r.type === "ADVISORY")?.url ??
            detail.references?.find((r) => r.url)?.url ??
            `https://osv.dev/vulnerability/${osvId}`;
        return { osvId, summary: detail.summary, reference, aliases: detail.aliases };
    }
    catch (error) {
        console.warn(`OSV detail lookup failed for ${osvId}:`, error instanceof Error ? error.message : error);
        return { osvId, reference: `https://osv.dev/vulnerability/${osvId}` };
    }
}
/**
 * Cross-references a set of package names against OSV's malicious-package feed.
 * Returns a map of only the packages that carry a confirmed `MAL-` advisory.
 */
async function queryMalwareAdvisories(packageNames, osvEcosystem, fetchImpl = fetch) {
    const advisories = new Map();
    if (packageNames.length === 0)
        return advisories;
    try {
        const res = await fetchWithTimeout(OSV_BATCH_URL, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ queries: packageNames.map((name) => ({ package: { name, ecosystem: osvEcosystem } })) }),
        }, fetchImpl);
        if (!res.ok)
            throw new Error(`OSV batch query failed (${res.status})`);
        const body = (await res.json());
        const results = body.results ?? [];
        // OSV aligns results positionally with the submitted queries.
        const malwareHits = packageNames
            .map((name, index) => ({ name, malId: (results[index]?.vulns ?? []).map((v) => v.id).find(isMalwareId) }))
            .filter((hit) => Boolean(hit.malId));
        await Promise.all(malwareHits.map(async ({ name, malId }) => {
            const detail = await fetchMalwareDetail(malId, fetchImpl);
            advisories.set(name, { packageName: name, ...detail });
        }));
    }
    catch (error) {
        // Fail open: an OSV outage must never block an otherwise-passing PR.
        console.error("OSV malware cross-reference failed; failing open:", error instanceof Error ? error.message : error);
    }
    return advisories;
}
