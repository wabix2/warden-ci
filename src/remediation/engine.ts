import semver from "semver";

export type RemediationEcosystem = "npm" | "python";

export type RemediationInput = {
  ecosystem: RemediationEcosystem;
  packageName: string;
  vulnerableRange: string;
  targetVersion: string;
  manifestPath: string;
  manifestContent: string;
};

export type RemediationResult = {
  manifestContent: string;
  manifestPath: string;
  packageName: string;
  from: string;
  to: string;
  changedSection: string;
};

function assertTarget(targetVersion: string, vulnerableRange: string): void {
  const cleanTarget = semver.valid(semver.coerce(targetVersion));
  if (!cleanTarget || !semver.validRange(vulnerableRange) || semver.satisfies(cleanTarget, vulnerableRange)) {
    throw new Error("Target version is invalid or remains vulnerable");
  }
}

function updateNpm(input: RemediationInput): RemediationResult {
  if (input.manifestPath !== "package.json") throw new Error("Unsupported npm manifest");
  const packageJson = JSON.parse(input.manifestContent) as Record<string, Record<string, string>>;
  const sections = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];
  const matches = sections.filter((section) => typeof packageJson[section]?.[input.packageName] === "string");
  if (matches.length !== 1) throw new Error(matches.length === 0 ? "Dependency is not present" : "Dependency entry is ambiguous");
  assertTarget(input.targetVersion, input.vulnerableRange);
  const section = matches[0];
  const previous = packageJson[section][input.packageName];
  const prefix = /^[~^<>=*\s|]/.test(previous) ? previous.match(/^[~^<>=*\s|]+/)?.[0] || "" : "";
  packageJson[section][input.packageName] = `${prefix}${semver.clean(input.targetVersion)}`;
  return { manifestContent: `${JSON.stringify(packageJson, null, 2)}\n`, manifestPath: input.manifestPath, packageName: input.packageName, from: previous, to: packageJson[section][input.packageName], changedSection: section };
}

function updatePython(input: RemediationInput): RemediationResult {
  if (input.manifestPath !== "requirements.txt") throw new Error("Unsupported Python manifest");
  assertTarget(input.targetVersion, input.vulnerableRange);
  const lines = input.manifestContent.split(/(\r?\n)/);
  let matches = 0;
  let previous = "";
  const output = lines.map((line) => {
    if (/^\s*#/.test(line) || !line.includes(input.packageName)) return line;
    const match = line.match(new RegExp(`^(\\s*${input.packageName.replace(/[.*+?^${}()|[\\]\\]/g, "\\\\$&")})(==|>=|~=|>|<)([^\\s;]+)(.*)$`, "i"));
    if (!match) return line;
    matches += 1; previous = `${match[2]}${match[3]}`;
    return `${match[1]}==${semver.clean(input.targetVersion)}${match[4]}`;
  });
  if (matches !== 1) throw new Error(matches === 0 ? "Dependency is not present or syntax is unsupported" : "Dependency entry is ambiguous");
  return { manifestContent: output.join(""), manifestPath: input.manifestPath, packageName: input.packageName, from: previous, to: `==${semver.clean(input.targetVersion)}`, changedSection: "requirements" };
}

export function applyDependencyRemediation(input: RemediationInput): RemediationResult {
  if (!input.packageName.trim() || !input.manifestContent) throw new Error("Invalid remediation input");
  return input.ecosystem === "npm" ? updateNpm(input) : updatePython(input);
}

export function manifestDiffIsScoped(before: string, after: string, packageName: string): boolean {
  const beforeLines = before.split(/\r?\n/);
  const afterLines = after.split(/\r?\n/);
  if (beforeLines.length !== afterLines.length && !before.endsWith("\n")) return false;
  const differences = afterLines.filter((line, index) => line !== beforeLines[index]);
  return differences.length === 1 && differences[0].toLowerCase().includes(packageName.toLowerCase());
}
