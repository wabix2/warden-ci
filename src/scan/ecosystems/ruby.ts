import { Ecosystem, PackageMetadata } from "./types";
import { cachedMetadata, metadataFromResponse, unavailableMetadata } from "./registry";

export const rubyEcosystem: Ecosystem = {
  id: "rubygems.org",
  label: "RubyGems",
  extensions: [".rb", ".gemspec", ".gemfile"],
  popularPackages: [],
  extractPackages(lines) {
    const packages = new Map<string, number[]>();
    lines.forEach(({ line, content }) => {
      for (const match of content.matchAll(/gem\s+["']([a-zA-Z0-9_-]+)["']/g)) packages.set(match[1], [...(packages.get(match[1]) || []), line]);
    });
    return packages;
  },
  async fetchMetadata(packageName): Promise<PackageMetadata> {
    return cachedMetadata(rubyEcosystem, packageName, async () => {
      try {
        const response = await fetch(`https://rubygems.org/api/v1/gems/${encodeURIComponent(packageName)}.json`);
        const status = metadataFromResponse(response.status);
        if (status) return status;
        const data = await response.json() as { created_at?: string; version?: string };
        return { existsOnRegistry: true, lookupStatus: "ok", latestVersion: data.version, publishedDaysAgo: data.created_at ? Math.floor((Date.now() - Date.parse(data.created_at)) / 86400000) : undefined };
      } catch { return unavailableMetadata(); }
    });
  },
};
