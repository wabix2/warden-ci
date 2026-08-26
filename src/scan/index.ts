import path from "path";
import { parseAddedLines } from "./diff";
import { checkSecrets } from "./secrets";
import { checkDangerousExec } from "./dangerousExec";
import { assessPackage, PackageVerdict } from "./riskSignals";
import { npmEcosystem } from "./ecosystems/npm";
import { pypiEcosystem } from "./ecosystems/pypi";
import { Ecosystem } from "./ecosystems/types";

export interface ScannedFile {
  filename: string;
  patch: string | null | undefined;
}

export type Severity = "warning" | "failure";

export interface ScanAnnotation {
  path: string;
  line: number;
  message: string;
  title: string;
  severity: Severity;
}

/** One row per distinct flagged package, for telemetry — independent of how many lines/files referenced it. */
export interface PackageFlag {
  ecosystem: string;
  verdict: PackageVerdict["verdict"];
  packageName: string;
  impersonating?: string;
}

export interface ScanResult {
  annotations: ScanAnnotation[];
  packageFlags: PackageFlag[];
  filesScanned: number;
  filesSkipped: number;
}

const MAX_ANNOTATIONS = 50; // GitHub Check Run API accepts at most 50 annotations per request

const ECOSYSTEMS: Ecosystem[] = [npmEcosystem, pypiEcosystem];

function ecosystemForFile(filename: string): Ecosystem | undefined {
  const ext = path.extname(filename).toLowerCase();
  return ECOSYSTEMS.find((e) => e.extensions.includes(ext));
}

async function checkPackageRisk(
  ecosystem: Ecosystem,
  linesByPackage: Map<string, number[]>
): Promise<{ annotations: Omit<ScanAnnotation, "path">[]; flags: PackageFlag[] }> {
  const annotations: Omit<ScanAnnotation, "path">[] = [];
  const flags: PackageFlag[] = [];
  const packages = [...linesByPackage.keys()];

  const CONCURRENCY = 8;
  for (let i = 0; i < packages.length; i += CONCURRENCY) {
    const batch = packages.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map((pkg) => assessPackage(pkg, ecosystem)));
    batch.forEach((pkg, idx) => {
      const verdict = results[idx];
      if (!verdict) return;

      flags.push({ ecosystem: ecosystem.id, verdict: verdict.verdict, packageName: pkg, impersonating: verdict.impersonating });

      const lines = linesByPackage.get(pkg)!;
      for (const line of lines) {
        if (verdict.verdict === "hallucinated") {
          annotations.push({
            line,
            title: "Unverified package",
            severity: "warning",
            message: `Package "${pkg}" was not found on the ${ecosystem.label} registry. If this was suggested by an AI tool, it may be a hallucinated package name — verify before merging, since attackers register exactly these invented names to distribute malware.`,
          });
        } else {
          annotations.push({
            line,
            title: "Possible typosquat package",
            severity: "failure",
            message: `Package "${pkg}" exists but was only published ${verdict.publishedDaysAgo} day(s) ago and is a near-exact match for the popular package "${verdict.impersonating}". This is a common pattern for typosquat/slopsquat attacks — confirm this is the package you meant before merging.`,
          });
        }
      }
    });
  }

  return { annotations, flags };
}

export async function scanFiles(files: ScannedFile[]): Promise<ScanResult> {
  const annotations: ScanAnnotation[] = [];
  const packageFlags: PackageFlag[] = [];
  let filesScanned = 0;
  let filesSkipped = 0;

  for (const file of files) {
    const addedLines = parseAddedLines(file.patch);
    if (addedLines.length === 0) {
      filesSkipped += 1;
      continue;
    }
    filesScanned += 1;

    const secrets = checkSecrets(addedLines);
    for (const f of secrets) {
      annotations.push({ path: file.filename, line: f.line, message: f.message, title: "Possible hardcoded secret", severity: "failure" });
    }

    const dangerousExec = checkDangerousExec(addedLines);
    for (const f of dangerousExec) {
      annotations.push({ path: file.filename, line: f.line, message: f.message, title: "Dangerous dynamic execution", severity: "warning" });
    }

    const ecosystem = ecosystemForFile(file.filename);
    if (ecosystem) {
      const linesByPackage = ecosystem.extractPackages(addedLines);
      if (linesByPackage.size > 0) {
        const { annotations: pkgAnnotations, flags } = await checkPackageRisk(ecosystem, linesByPackage);
        for (const a of pkgAnnotations) {
          annotations.push({ ...a, path: file.filename });
        }
        packageFlags.push(...flags);
      }
    }
  }

  if (annotations.length > MAX_ANNOTATIONS) {
    annotations.length = MAX_ANNOTATIONS;
  }

  return { annotations, packageFlags, filesScanned, filesSkipped };
}
