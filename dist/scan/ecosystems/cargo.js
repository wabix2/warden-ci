"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cargoEcosystem = void 0;
const USE = /^\s*use\s+([a-zA-Z][a-zA-Z0-9_-]*)/;
const EXTERN = /^\s*extern\s+crate\s+([a-zA-Z][a-zA-Z0-9_-]*)/;
function extractPackages(addedLines) {
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
async function fetchMetadata(packageName) {
    try {
        const response = await fetch(`https://crates.io/api/v1/crates/${encodeURIComponent(packageName)}`, { headers: { "User-Agent": "Warden-CI/1.0" } });
        if (!response.ok)
            return { existsOnRegistry: false, lookupStatus: response.status === 404 ? "not_found" : "unavailable" };
        const body = await response.json();
        const created = body.crate?.created_at;
        return { lookupStatus: "ok", existsOnRegistry: true, latestVersion: body.crate?.max_version, publishedDaysAgo: created ? Math.floor((Date.now() - Date.parse(created)) / 86400000) : undefined };
    }
    catch {
        return { existsOnRegistry: false, lookupStatus: "unavailable" };
    }
}
exports.cargoEcosystem = { id: "cargo", label: "crates.io", extensions: [".rs"], popularPackages: ["serde", "tokio", "reqwest", "clap", "anyhow", "thiserror"], extractPackages, fetchMetadata };
