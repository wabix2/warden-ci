/**
 * Warden CI \u2014 dependency provenance checks.
 *
 * Looks specifically at manifest files touched in the PR (package.json, requirements.txt)
 * and flags newly-added packages that are very new, have very low adoption, or were
 * published by an account with no other history \u2014 the classic profile of a
 * typosquat or a hallucinated package name an LLM invented that someone then
 * registered maliciously to catch exactly this mistake.
 */

import fetch from "node-fetch";
import { ChangedFile, DependencyFinding } from "./types";

const NEW_PACKAGE_DAYS_THRESHOLD = 30;
// Weekly-downloads threshold used only as a secondary signal (see checkNpmPackage).
// 1000/week flagged huge numbers of perfectly legitimate niche/internal-tooling packages
// as "medium risk" on their own; 200/week combined with the age check produces far less noise.
const LOW_DOWNLOADS_THRESHOLD = 200;

function extractAddedNpmDeps(patch: string): { name: string; version?: string }[] {
  const added: { name: string; version?: string }[] = [];
  const lines = patch.split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++"));
  for (const line of lines) {
    const match = line.match(/"([a-zA-Z0-9._@/-]+)"\s*:\s*"([^"]+)"/);
    if (match && !["name", "version", "description", "main", "license", "author"].includes(match[1])) {
      added.push({ name: match[1], version: match[2] });
    }
  }
  return added;
}

function extractAddedPyDeps(patch: string): { name: string; version?: string }[] {
  const added: { name: string; version?: string }[] = [];
  const lines = patch.split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++"));
  for (const line of lines) {
    const trimmed = line.slice(1).trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([a-zA-Z0-9_.-]+)\s*(==|>=|<=|~=|>|<)?\s*([a-zA-Z0-9.\-*]*)/);
    if (match && match[1]) {
      added.push({ name: match[1], version: match[3] || undefined });
    }
  }
  return added;
}

async function checkNpmPackage(name: string, version?: string): Promise<DependencyFinding> {
  const reasons: string[] = [];
  let riskLevel: DependencyFinding["riskLevel"] = "low";

  try {
    const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}`);
    if (res.status === 404) {
      return {
        ecosystem: "npm",
        name,
        version,
        riskLevel: "high",
        reasons: ["Package does not exist on the npm registry \u2014 possible hallucinated dependency name or a since-removed/typosquat package."],
      };
    }
    const data = (await res.json()) as any;
    const created = data?.time?.created ? new Date(data.time.created) : null;
    let isNew = false;
    if (created) {
      const ageDays = (Date.now() - created.getTime()) / (1000 * 60 * 60 * 24);
      isNew = ageDays < NEW_PACKAGE_DAYS_THRESHOLD;
      if (isNew) reasons.push(`Package was first published only ${Math.round(ageDays)} day(s) ago.`);
    }

    let isLowAdoption = false;
    const downloadsRes = await fetch(`https://api.npmjs.org/downloads/point/last-week/${encodeURIComponent(name)}`);
    if (downloadsRes.ok) {
      const downloadsData = (await downloadsRes.json()) as any;
      const downloads = downloadsData?.downloads ?? 0;
      isLowAdoption = downloads < LOW_DOWNLOADS_THRESHOLD;
      if (isLowAdoption) reasons.push(`Only ${downloads} weekly download(s) at time of scan.`);
    }

    // A package can legitimately be low-download (small internal tool, niche utility) or
    // legitimately new (a real team just published something) without being suspicious.
    // Only escalate risk when BOTH signals line up \u2014 that combination is what actually
    // resembles a typosquat or a package registered to catch a hallucinated import name.
    if (isNew && isLowAdoption) {
      riskLevel = "high";
    } else if (isNew || isLowAdoption) {
      riskLevel = "medium";
    }
  } catch (err) {
    reasons.push(`Could not verify package against npm registry (${(err as Error).message}).`);
    riskLevel = "medium";
  }

  return { ecosystem: "npm", name, version, riskLevel, reasons };
}

async function checkPyPiPackage(name: string, version?: string): Promise<DependencyFinding> {
  const reasons: string[] = [];
  let riskLevel: DependencyFinding["riskLevel"] = "low";

  try {
    const res = await fetch(`https://pypi.org/pypi/${encodeURIComponent(name)}/json`);
    if (res.status === 404) {
      return {
        ecosystem: "pypi",
        name,
        version,
        riskLevel: "high",
        reasons: ["Package does not exist on PyPI \u2014 possible hallucinated dependency name or typosquat."],
      };
    }
    const data = (await res.json()) as any;
    const releases = data?.releases || {};
    const releaseDates: Date[] = Object.values(releases)
      .flat()
      .map((r: any) => r?.upload_time_iso_8601)
      .filter(Boolean)
      .map((d: string) => new Date(d));
    const earliest = releaseDates.sort((a, b) => a.getTime() - b.getTime())[0];
    if (earliest) {
      const ageDays = (Date.now() - earliest.getTime()) / (1000 * 60 * 60 * 24);
      if (ageDays < NEW_PACKAGE_DAYS_THRESHOLD) {
        reasons.push(`Package's first release was only ${Math.round(ageDays)} day(s) ago.`);
        // Medium, not high: PyPI doesn't expose a reliable free downloads API, so this is
        // a single signal on its own \u2014 consistent with how npm packages are only escalated
        // to "high" when newness AND low adoption line up together.
        riskLevel = "medium";
      }
    }
  } catch (err) {
    reasons.push(`Could not verify package against PyPI (${(err as Error).message}).`);
    riskLevel = "medium";
  }

  return { ecosystem: "pypi", name, version, riskLevel, reasons };
}

export async function checkDependencies(files: ChangedFile[]): Promise<DependencyFinding[]> {
  const findings: DependencyFinding[] = [];

  for (const file of files) {
    if (!file.patch) continue;

    if (file.filename.endsWith("package.json")) {
      const deps = extractAddedNpmDeps(file.patch);
      for (const dep of deps) {
        findings.push(await checkNpmPackage(dep.name, dep.version));
      }
    } else if (file.filename.endsWith("requirements.txt") || file.filename.endsWith("pyproject.toml")) {
      const deps = extractAddedPyDeps(file.patch);
      for (const dep of deps) {
        findings.push(await checkPyPiPackage(dep.name, dep.version));
      }
    }
  }

  // Only surface non-trivial findings \u2014 a clean, well-established dependency shouldn't
  // clutter the PR check with a "low risk, no issues" entry.
  return findings.filter((f) => f.riskLevel !== "low" || f.reasons.length > 0);
}
