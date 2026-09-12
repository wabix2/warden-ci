"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveOsvAdvisory = resolveOsvAdvisory;
async function resolveOsvAdvisory(ecosystem, packageName, version, fetcher = fetch) {
    const queryEcosystem = ecosystem === "python" ? "PyPI" : "npm";
    const response = await fetcher("https://api.osv.dev/v1/query", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ package: { name: packageName, ecosystem: queryEcosystem }, version }) });
    if (!response.ok)
        throw new Error(`OSV lookup failed (${response.status})`);
    const body = await response.json();
    for (const vulnerability of body.vulns || []) {
        for (const affected of vulnerability.affected || []) {
            if (affected.package?.name !== packageName)
                continue;
            const fixedVersion = affected.ranges?.flatMap((range) => range.events || []).find((event) => event.fixed)?.fixed;
            if (vulnerability.id && fixedVersion)
                return { id: vulnerability.id, packageName, ecosystem: queryEcosystem, affectedRange: "OSV advisory range", fixedVersion, severity: vulnerability.severity?.[0]?.score };
        }
    }
    return null;
}
