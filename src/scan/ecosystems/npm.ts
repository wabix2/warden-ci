import { builtinModules } from "module";
import { AddedLine } from "../diff";
import { Ecosystem, PackageMetadata } from "./types";
import { POPULAR_NPM_PACKAGES } from "../popularPackages";

const IMPORT_PATTERNS = [
  /\bfrom\s+['"]([^'"]+)['"]/g,
  /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
];

const BUILTIN = new Set([...builtinModules, ...builtinModules.map((m) => `node:${m}`)]);

function packageNameFromSpecifier(specifier: string): string | null {
  if (specifier.startsWith(".") || specifier.startsWith("/") || specifier.startsWith("http:") || specifier.startsWith("https:")) {
    return null;
  }
  const parts = specifier.split("/");
  if (specifier.startsWith("@")) {
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : null;
  }
  return parts[0] || null;
}

function extractPackages(addedLines: AddedLine[]): Map<string, number[]> {
  const linesByPackage = new Map<string, number[]>();
  for (const { line, content } of addedLines) {
    for (const pattern of IMPORT_PATTERNS) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(content)) !== null) {
        const pkg = packageNameFromSpecifier(match[1]);
        if (!pkg || BUILTIN.has(pkg)) continue;
        const existing = linesByPackage.get(pkg) ?? [];
        existing.push(line);
        linesByPackage.set(pkg, existing);
      }
    }
  }
  return linesByPackage;
}

async function fetchMetadata(packageName: string): Promise<PackageMetadata> {
  const encoded = packageName.startsWith("@")
    ? `@${encodeURIComponent(packageName.slice(1))}`
    : encodeURIComponent(packageName);

  try {
    const res = await fetch(`https://registry.npmjs.org/${encoded}`);
    if (!res.ok) {
      // 404 = genuinely doesn't exist. Any other non-OK status is treated as
      // "exists" (fail open) since we can't distinguish a real 404 from a
      // registry hiccup any other way with this endpoint.
      return { existsOnRegistry: res.status !== 404 };
    }
    const data = (await res.json()) as { time?: Record<string, string> };
    const created = data.time?.created;
    const publishedDaysAgo = created
      ? Math.floor((Date.now() - new Date(created).getTime()) / (1000 * 60 * 60 * 24))
      : undefined;
    return { existsOnRegistry: true, publishedDaysAgo };
  } catch (err) {
    console.error(`npm metadata lookup failed for "${packageName}":`, err);
    return { existsOnRegistry: true }; // fail open on network errors
  }
}

export const npmEcosystem: Ecosystem = {
  id: "npm",
  label: "npm",
  extensions: [".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".mts", ".cts"],
  popularPackages: POPULAR_NPM_PACKAGES,
  extractPackages,
  fetchMetadata,
};
