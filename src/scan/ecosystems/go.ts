import { AddedLine } from "../diff";
import { Ecosystem, PackageMetadata } from "./types";
import { cachedMetadata, metadataFromResponse, unavailableMetadata } from "./registry";

const IMPORT = /^\s*import\s+(?:\([^)]*\)|"([^"]+)"|[a-zA-Z0-9_.-]+\s+"([^"]+)")/;
const IMPORT_PATH = /"([a-zA-Z0-9._~:/+-]+)"/;

function extractPackages(addedLines: AddedLine[]): Map<string, number[]> {
  const result = new Map<string, number[]>();
  for (const { line, content } of addedLines) {
    if (!/^\s*import\b/.test(content)) continue;
    const matches = [...content.matchAll(/"([^"]+)"/g)];
    for (const match of matches) {
      const path = match[1];
      if (!path.includes(".") && !path.includes("/") || path.startsWith("internal/")) continue;
      const module = path.split("/").slice(0, 3).join("/");
      result.set(module, [...(result.get(module) ?? []), line]);
    }
  }
  return result;
}

async function fetchMetadataUncached(packageName: string): Promise<PackageMetadata> {
  const encoded = encodeURIComponent(packageName);
  try {
    const response = await fetch(`https://proxy.golang.org/${encoded}/@latest`);
    const status = metadataFromResponse(response.status);
    if (status) return status;
    const body = await response.json() as { Version?: string; Time?: string };
    return { lookupStatus: "ok", existsOnRegistry: true, latestVersion: body.Version, publishedDaysAgo: body.Time ? Math.floor((Date.now() - Date.parse(body.Time)) / 86400000) : undefined };
  } catch {
    return { existsOnRegistry: false, lookupStatus: "unavailable" };
  }
}

const fetchMetadata = (packageName: string) => cachedMetadata(goEcosystem, packageName, () => fetchMetadataUncached(packageName));

export const goEcosystem: Ecosystem = { id: "go", label: "Go modules", extensions: [".go"], popularPackages: ["github.com/stretchr/testify", "github.com/gin-gonic/gin", "golang.org/x/net", "golang.org/x/sync"], extractPackages, fetchMetadata };
