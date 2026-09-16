import { AddedLine } from "../diff";
import { Ecosystem, PackageMetadata } from "./types";
import { POPULAR_PYPI_PACKAGES } from "../popularPackages";
import { PYTHON_STDLIB } from "./pythonStdlib";

// `import foo`, `import foo.bar`, `from foo import bar`, `from foo.bar import baz`
const IMPORT_LINE = /^\s*(?:import\s+([a-zA-Z_][a-zA-Z0-9_]*)|from\s+([a-zA-Z_][a-zA-Z0-9_]*)(?:\.[a-zA-Z0-9_.]+)?\s+import)/;

// PyPI project names for a top-level module aren't always identical (e.g. `import yaml`
// comes from the "PyYAML" package) — this is a best-effort map for the common
// mismatches. Anything not listed here is assumed to match its import name directly,
// which is true for the large majority of packages.
const IMPORT_TO_PACKAGE_NAME: Record<string, string> = {
  yaml: "pyyaml",
  cv2: "opencv-python",
  bs4: "beautifulsoup4",
  sklearn: "scikit-learn",
  PIL: "pillow",
  google: "google-cloud-storage", // ambiguous namespace package; best-effort only
  jwt: "pyjwt",
  dotenv: "python-dotenv",
};

function extractPackages(addedLines: AddedLine[]): Map<string, number[]> {
  const linesByPackage = new Map<string, number[]>();
  for (const { line, content } of addedLines) {
    const match = IMPORT_LINE.exec(content);
    if (!match) continue;
    const moduleName = match[1] || match[2];
    if (!moduleName || PYTHON_STDLIB.has(moduleName)) continue;
    const pkg = IMPORT_TO_PACKAGE_NAME[moduleName] || moduleName;
    const existing = linesByPackage.get(pkg) ?? [];
    existing.push(line);
    linesByPackage.set(pkg, existing);
  }
  return linesByPackage;
}

async function fetchMetadata(packageName: string): Promise<PackageMetadata> {
  try {
    const res = await fetch(`https://pypi.org/pypi/${encodeURIComponent(packageName)}/json`);
    if (!res.ok) {
      return { existsOnRegistry: false, lookupStatus: res.status === 404 ? "not_found" : "unavailable" };
    }
    // PyPI JSON exposes release files and upload timestamps, but no per-release
    // uploader identity. Maintainer-takeover detection is therefore npm-only.
    const data = (await res.json()) as { info?: { version?: string }; releases?: Record<string, Array<{ upload_time_iso_8601?: string }>> };
    let earliest: number | undefined;
    for (const files of Object.values(data.releases ?? {})) {
      for (const file of files) {
        if (!file.upload_time_iso_8601) continue;
        const t = new Date(file.upload_time_iso_8601).getTime();
        if (earliest === undefined || t < earliest) earliest = t;
      }
    }
    const publishedDaysAgo = earliest !== undefined ? Math.floor((Date.now() - earliest) / (1000 * 60 * 60 * 24)) : undefined;
    const releaseCount = Object.keys(data.releases ?? {}).length;
    return { lookupStatus: "ok", existsOnRegistry: true, publishedDaysAgo, latestVersion: data.info?.version, releaseCount };
  } catch (err) {
    console.error(`PyPI metadata lookup failed for "${packageName}":`, err);
    return { existsOnRegistry: false, lookupStatus: "unavailable" };
  }
}

export const pypiEcosystem: Ecosystem = {
  id: "pypi",
  label: "PyPI",
  extensions: [".py"],
  popularPackages: POPULAR_PYPI_PACKAGES,
  extractPackages,
  fetchMetadata,
};
