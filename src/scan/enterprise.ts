import { createHash } from "node:crypto";
import type { ScanAnnotation, ScanResult, Severity } from "./index";

export interface ScanPolicy {
  mode: "block" | "report";
  minimumSeverity: "warning" | "failure";
  blockCategories: Array<ScanAnnotation["category"]>;
  failOnIncomplete: boolean;
}

export const defaultScanPolicy: ScanPolicy = {
  mode: "block",
  minimumSeverity: "failure",
  blockCategories: ["secret", "execution", "dependency"],
  failOnIncomplete: true,
};

const severityRank: Record<Severity, number> = { warning: 1, failure: 2 };

export function fingerprintFinding(input: Pick<ScanAnnotation, "category" | "path" | "line" | "title" | "message">): string {
  return createHash("sha256")
    .update([input.category, input.path, input.line, input.title, input.message].join("\0"))
    .digest("hex")
    .slice(0, 32);
}

export function evaluatePolicy(result: ScanResult, policy: ScanPolicy = defaultScanPolicy) {
  const blocking = result.annotations.filter((finding) =>
    policy.mode === "block" &&
    policy.blockCategories.includes(finding.category) &&
    severityRank[finding.severity] >= severityRank[policy.minimumSeverity],
  );
  const incomplete = result.verdict === "incomplete";
  return {
    verdict: blocking.length > 0 || (incomplete && policy.failOnIncomplete) ? "fail" as const : "pass" as const,
    blocking,
    incomplete,
    reason: incomplete ? "The scan did not inspect every changed file." : blocking.length ? `${blocking.length} policy violation(s) require remediation.` : "No blocking policy violations found.",
  };
}

export function toSarif(result: ScanResult, toolVersion = "1.0.0") {
  return {
    version: "2.1.0",
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    runs: [{
      tool: { driver: { name: "Warden CI", version: toolVersion, informationUri: "https://warden-ci.dev" } },
      results: result.annotations.map((finding) => ({
        ruleId: finding.fingerprint,
        level: finding.severity === "failure" ? "error" : "warning",
        message: { text: finding.message },
        locations: [{ physicalLocation: { artifactLocation: { uri: finding.path }, region: { startLine: finding.line } } }],
        fixes: [{ description: { text: finding.remediation } }],
      })),
    }],
  };
}

export function toCycloneDx(result: ScanResult) {
  return {
    bomFormat: "CycloneDX",
    specVersion: "1.5",
    version: 1,
    metadata: { tools: [{ vendor: "Warden CI", name: "Warden scanner", version: "1.0.0" }] },
    components: result.packageFlags.map((flag) => ({ type: "library", name: flag.packageName, scope: "required", properties: [{ name: "warden:ecosystem", value: flag.ecosystem }, { name: "warden:risk", value: flag.verdict }] })),
  };
}

export function redact(value: string): string {
  return value.replace(/(sk-(?:proj|admin|live)-|sk-ant-|npm_|SG\.)[A-Za-z0-9_.-]+/g, "$1[REDACTED]");
}
