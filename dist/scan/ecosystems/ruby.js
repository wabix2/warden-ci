"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rubyEcosystem = void 0;
exports.rubyEcosystem = {
    id: "rubygems.org",
    label: "RubyGems",
    extensions: [".rb", ".gemspec", ".gemfile"],
    popularPackages: ["rails", "rack", "nokogiri", "devise", "sidekiq"],
    extractPackages(lines) {
        const packages = new Map();
        lines.forEach(({ line, content }) => {
            const matches = content.matchAll(/gem\s+["']([a-zA-Z0-9_-]+)["']/g);
            for (const match of matches)
                packages.set(match[1], [...(packages.get(match[1]) || []), line]);
        });
        return packages;
    },
    async fetchMetadata(packageName) {
        try {
            const response = await fetch(`https://rubygems.org/api/v1/gems/${encodeURIComponent(packageName)}.json`);
            if (!response.ok)
                return { existsOnRegistry: false };
            const data = await response.json();
            return { existsOnRegistry: true, publishedDaysAgo: data.created_at ? Math.floor((Date.now() - Date.parse(data.created_at)) / 86400000) : undefined };
        }
        catch {
            return { existsOnRegistry: true };
        }
    },
};
