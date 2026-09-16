import { Ecosystem } from "./types";

export const rustEcosystem: Ecosystem = {
  id: "crates.io",
  label: "crates.io",
  extensions: [".rs", ".toml"],
  popularPackages: ["serde", "tokio", "reqwest", "clap", "anyhow"],
  extractPackages(lines) {
    const packages = new Map<string, number[]>();
    lines.forEach(({ line, content }) => {
      const matches = content.matchAll(/(?:use|extern\s+crate)\s+([a-zA-Z0-9_-]+)/g);
      for (const match of matches) packages.set(match[1], [...(packages.get(match[1]) || []), line]);
    });
    return packages;
  },
  async fetchMetadata(packageName) {
    try {
      const response = await fetch(`https://crates.io/api/v1/crates/${encodeURIComponent(packageName)}`, { headers: { "User-Agent": "Warden-CI/1.0" } });
      if (!response.ok) return { existsOnRegistry: false };
      const data = await response.json() as { crate?: { created_at?: string } };
      return { existsOnRegistry: true, publishedDaysAgo: data.crate?.created_at ? Math.floor((Date.now() - Date.parse(data.crate.created_at)) / 86400000) : undefined };
    } catch { return { existsOnRegistry: true }; }
  },
};
