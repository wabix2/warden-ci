"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.goEcosystem = void 0;
const registry_1 = require("./registry");
const IMPORT = /^\s*import\s+(?:\([^)]*\)|"([^"]+)"|[a-zA-Z0-9_.-]+\s+"([^"]+)")/;
const IMPORT_PATH = /"([a-zA-Z0-9._~:/+-]+)"/;
function extractPackages(addedLines) {
    const result = new Map();
    for (const { line, content } of addedLines) {
        if (!/^\s*import\b/.test(content))
            continue;
        const matches = [...content.matchAll(/"([^"]+)"/g)];
        for (const match of matches) {
            const path = match[1];
            if (!path.includes(".") && !path.includes("/") || path.startsWith("internal/"))
                continue;
            const module = path.split("/").slice(0, 3).join("/");
            result.set(module, [...(result.get(module) ?? []), line]);
        }
    }
    return result;
}
async function fetchMetadataUncached(packageName) {
    const encoded = encodeURIComponent(packageName);
    try {
        const response = await fetch(`https://proxy.golang.org/${encoded}/@latest`);
        const status = (0, registry_1.metadataFromResponse)(response.status);
        if (status)
            return status;
        const body = await response.json();
        return { lookupStatus: "ok", existsOnRegistry: true, latestVersion: body.Version, publishedDaysAgo: body.Time ? Math.floor((Date.now() - Date.parse(body.Time)) / 86400000) : undefined };
    }
    catch {
        return { existsOnRegistry: false, lookupStatus: "unavailable" };
    }
}
const fetchMetadata = (packageName) => (0, registry_1.cachedMetadata)(exports.goEcosystem, packageName, () => fetchMetadataUncached(packageName));
exports.goEcosystem = { id: "go", label: "Go modules", extensions: [".go"], popularPackages: ["github.com/stretchr/testify", "github.com/gin-gonic/gin", "golang.org/x/net", "golang.org/x/sync"], extractPackages, fetchMetadata };
