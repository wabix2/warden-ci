import type { ScanAnnotation } from "../scan";

export type Severity = "warning" | "failure";
export type EnforcementMode = "block" | "report";

export interface EnforcementPolicy {
  mode: EnforcementMode;
  minimumSeverity: Severity;
  blockSecrets: boolean;
  blockMaliciousPackages: boolean;
  blockDangerousExec: boolean;
  requireCleanBaseline: boolean;
}

const DEFAULT_POLICY: EnforcementPolicy = {
  mode: "block",
  minimumSeverity: "failure",
  blockSecrets: true,
  blockMaliciousPackages: true,
  blockDangerousExec: true,
  requireCleanBaseline: true,
};

export function evaluateGate(annotations: ScanAnnotation[], policy: Partial<EnforcementPolicy> = {}) {
  const effective = { ...DEFAULT_POLICY, ...policy };
  const blocking = annotations.filter((annotation) => {
    if (annotation.title === "Possible hardcoded secret") return effective.blockSecrets;
    if (annotation.title === "Possible typosquat package" || annotation.title === "Unverified package") return effective.blockMaliciousPackages;
    if (annotation.title === "Dangerous dynamic execution") return effective.blockDangerousExec;
    return annotation.severity === effective.minimumSeverity;
  });

  return {
    policy: effective,
    blocking,
    shouldBlock: effective.mode === "block" && blocking.length > 0,
    verdict: blocking.length > 0 ? "failure" as const : "success" as const,
  };
}
