"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.npmEcosystem = void 0;
const module_1 = require("module");
const popularPackages_1 = require("../popularPackages");
const registry_1 = require("./registry");
const IMPORT_PATTERNS = [
    /\bfrom\s+['"]([^'"]+)['"]/g,
    /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
];
const BUILTIN = new Set([...module_1.builtinModules, ...module_1.builtinModules.map((m) => `node:${m}`)]);
function packageNameFromSpecifier(specifier) {
    if (specifier.startsWith(".") || specifier.startsWith("/") || specifier.startsWith("http:") || specifier.startsWith("https:")) {
        return null;
    }
    const parts = specifier.split("/");
    if (specifier.startsWith("@")) {
        return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : null;
    }
    return parts[0] || null;
}
function extractPackages(addedLines) {
    const linesByPackage = new Map();
    for (const { line, content } of addedLines) {
        for (const pattern of IMPORT_PATTERNS) {
            pattern.lastIndex = 0;
            let match;
            while ((match = pattern.exec(content)) !== null) {
                const pkg = packageNameFromSpecifier(match[1]);
                if (!pkg || BUILTIN.has(pkg))
                    continue;
                const existing = linesByPackage.get(pkg) ?? [];
                existing.push(line);
                linesByPackage.set(pkg, existing);
            }
        }
    }
    return linesByPackage;
}
async function fetchMetadataUncached(packageName) {
    const encoded = packageName.startsWith("@")
        ? `@${encodeURIComponent(packageName.slice(1))}`
        : encodeURIComponent(packageName);
    try {
        const res = await fetch(`https://registry.npmjs.org/${encoded}`);
        if (!res.ok) {
            // 404 = genuinely doesn't exist. Any other non-OK status is treated as
            // "exists" (fail open) since we can't distinguish a real 404 from a
            // registry hiccup any other way with this endpoint.
            return (0, registry_1.metadataFromResponse)(res.status);
        }
        const data = (await res.json());
        const created = data.time?.created;
        const latestVersion = data["dist-tags"]?.latest;
        const releaseTimes = Object.entries(data.time ?? {}).filter(([version, value]) => version !== "created" && version !== "modified" && !Number.isNaN(Date.parse(value)));
        const latestRelease = latestVersion ? data.time?.[latestVersion] : undefined;
        const publisherSequence = releaseTimes.map(([version]) => data.versions?.[version]?._npmUser?.name).filter((name) => Boolean(name));
        const publisherHistory = [...new Set(publisherSequence)];
        const latestPublisher = publisherSequence.at(-1);
        const previousPublisher = publisherSequence.at(-2);
        const publishedDaysAgo = created ? Math.floor((Date.now() - new Date(created).getTime()) / (1000 * 60 * 60 * 24)) : undefined;
        const latestReleaseDaysAgo = latestRelease ? Math.floor((Date.now() - new Date(latestRelease).getTime()) / (1000 * 60 * 60 * 24)) : undefined;
        return { lookupStatus: "ok", existsOnRegistry: true, publishedDaysAgo, latestVersion, releaseCount: releaseTimes.length, publisherHistory, latestPublisher, publisherChangedRecently: Boolean(latestPublisher && previousPublisher && latestPublisher !== previousPublisher), latestReleaseDaysAgo };
    }
    catch (err) {
        console.error(`npm metadata lookup failed for "${packageName}":`, err);
        return { existsOnRegistry: false, lookupStatus: "unavailable" };
    }
}
const fetchMetadata = (packageName) => (0, registry_1.cachedMetadata)(exports.npmEcosystem, packageName, () => fetchMetadataUncached(packageName));
exports.npmEcosystem = {
    id: "npm",
    label: "npm",
    extensions: [".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".mts", ".cts"],
    popularPackages: popularPackages_1.POPULAR_NPM_PACKAGES,
    extractPackages,
    fetchMetadata,
};
