import { parse } from "smol-toml";
import { AddedLine } from "../diff";
import { Ecosystem, PackageMetadata } from "./types";
import { cachedMetadata, metadataFromResponse, unavailableMetadata } from "./registry";

const USE = /^\s*use\s+([a-zA-Z][a-zA-Z0-9_-]*)/;
const EXTERN = /^\s*extern\s+crate\s+([a-zA-Z][a-zA-Z0-9_-]*)/;

function extractPackages(addedLines: AddedLine[]): Map<string, number[]> {
  const manifestText = addedLines.map(({ content }) => content).join("\n");
  if (/^\s*\[(?:dependencies|dev-dependencies|build-dependencies)\]\s*$/m.test(manifestText)) {
    return extractCargoManifestPackages(manifestText, addedLines[0]?.line ?? 1);
  }
  const result = new Map<string, number[]>();
  for (const { line, content } of addedLines) {
    const match = USE.exec(content) ?? EXTERN.exec(content);
    if (!match || ["std", "core", "alloc", "crate", "self", "super"].includes(match[1])) continue;
    const name = match[1].replace(/_/g, "-");
    result.set(name, [...(result.get(name) ?? []), line]);
  }
  return result;
}

export function extractCargoManifestPackages(content: string, lineOffset = 1): Map<string, number[]> {
  const result = new Map<string, number[]>();
  try {
    const document = parse(content) as { dependencies?: Record<string, unknown>; "dev-dependencies"?: Record<string, unknown>; "build-dependencies"?: Record<string, unknown> };
    for (const section of [document.dependencies, document["dev-dependencies"], document["build-dependencies"]]) {
      for (const name of Object.keys(section ?? {})) result.set(name.replace(/_/g, "-"), [lineOffset]);
    }
  } catch { return result; }
  return result;
}

async function fetchMetadataUncached(packageName: string): Promise<PackageMetadata> {
  try {
    const response = await fetch(`https://crates.io/api/v1/crates/${encodeURIComponent(packageName)}`, { headers: { "User-Agent": "Warden-CI/1.0" } });
    const status = metadataFromResponse(response.status);
    if (status) return status;
    const body = await response.json() as { crate?: { max_version?: string; created_at?: string; updated_at?: string } };
    const created = body.crate?.created_at;
    return { existsOnRegistry: true, lookupStatus: "ok", latestVersion: body.crate?.max_version, publishedDaysAgo: created ? Math.floor((Date.now() - Date.parse(created)) / 86400000) : undefined };
  } catch { return unavailableMetadata(); }
}

async function fetchMetadata(packageName: string): Promise<PackageMetadata> {
  return cachedMetadata(cargoEcosystem, packageName, () => fetchMetadataUncached(packageName));
}

export const cargoEcosystem: Ecosystem = { id: "cargo", label: "crates.io", extensions: [".rs", ".toml"], popularPackages: [], extractPackages, fetchMetadata };
