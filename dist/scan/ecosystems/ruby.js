"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rubyEcosystem = void 0;
const registry_1 = require("./registry");
exports.rubyEcosystem = {
    id: "rubygems.org",
    label: "RubyGems",
    extensions: [".rb", ".gemspec", ".gemfile"],
    popularPackages: [],
    extractPackages(lines) {
        const packages = new Map();
        lines.forEach(({ line, content }) => {
            for (const match of content.matchAll(/gem\s+["']([a-zA-Z0-9_-]+)["']/g))
                packages.set(match[1], [...(packages.get(match[1]) || []), line]);
        });
        return packages;
    },
    async fetchMetadata(packageName) {
        return (0, registry_1.cachedMetadata)(exports.rubyEcosystem, packageName, async () => {
            try {
                const response = await fetch(`https://rubygems.org/api/v1/gems/${encodeURIComponent(packageName)}.json`);
                const status = (0, registry_1.metadataFromResponse)(response.status);
                if (status)
                    return status;
                const data = await response.json();
                return { existsOnRegistry: true, lookupStatus: "ok", latestVersion: data.version, publishedDaysAgo: data.created_at ? Math.floor((Date.now() - Date.parse(data.created_at)) / 86400000) : undefined };
            }
            catch {
                return (0, registry_1.unavailableMetadata)();
            }
        });
    },
};
