"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cargoEcosystem = void 0;
exports.extractCargoManifestPackages = extractCargoManifestPackages;
const smol_toml_1 = require("smol-toml");
const registry_1 = require("./registry");
const USE = /^\s*use\s+([a-zA-Z][a-zA-Z0-9_-]*)/;
const EXTERN = /^\s*extern\s+crate\s+([a-zA-Z][a-zA-Z0-9_-]*)/;
function extractPackages(addedLines) {
    const manifestText = addedLines.map(({ content }) => content).join("\n");
    if (/^\s*\[(?:dependencies|dev-dependencies|build-dependencies)\]\s*$/m.test(manifestText)) {
        return extractCargoManifestPackages(manifestText, addedLines[0]?.line ?? 1);
    }
    const result = new Map();
    for (const { line, content } of addedLines) {
        const match = USE.exec(content) ?? EXTERN.exec(content);
        if (!match || ["std", "core", "alloc", "crate", "self", "super"].includes(match[1]))
            continue;
        const name = match[1].replace(/_/g, "-");
        result.set(name, [...(result.get(name) ?? []), line]);
    }
    return result;
}
function extractCargoManifestPackages(content, lineOffset = 1) {
    const result = new Map();
    try {
        const document = (0, smol_toml_1.parse)(content);
        for (const section of [document.dependencies, document["dev-dependencies"], document["build-dependencies"]]) {
            for (const name of Object.keys(section ?? {}))
                result.set(name.replace(/_/g, "-"), [lineOffset]);
        }
    }
    catch {
        return result;
    }
    return result;
}
async function fetchMetadataUncached(packageName) {
    try {
        const response = await fetch(`https://crates.io/api/v1/crates/${encodeURIComponent(packageName)}`, { headers: { "User-Agent": "Warden-CI/1.0" } });
        const status = (0, registry_1.metadataFromResponse)(response.status);
        if (status)
            return status;
        const body = await response.json();
        const created = body.crate?.created_at;
        return { existsOnRegistry: true, lookupStatus: "ok", latestVersion: body.crate?.max_version, publishedDaysAgo: created ? Math.floor((Date.now() - Date.parse(created)) / 86400000) : undefined };
    }
    catch {
        return (0, registry_1.unavailableMetadata)();
    }
}
async function fetchMetadata(packageName) {
    return (0, registry_1.cachedMetadata)(exports.cargoEcosystem, packageName, () => fetchMetadataUncached(packageName));
}
exports.cargoEcosystem = { id: "cargo", label: "crates.io", extensions: [".rs", ".toml"], popularPackages: [], extractPackages, fetchMetadata };
