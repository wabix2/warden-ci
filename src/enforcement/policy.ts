import { createHmac, timingSafeEqual } from "node:crypto";
import type { ScanAnnotation } from "../scan";

export type Severity = "warning" | "failure";
export type EnforcementMode = "block" | "report";
export type PolicyRevision = "v1";

export interface PolicySuppression {
  id: string;
  fingerprint?: string;
  category?: ScanAnnotation["category"];
  reason: string;
  owner: string;
  expiresAt: string;
  approvedBy?: string;
}

export interface EnforcementPolicy {
  schema: PolicyRevision;
  mode: EnforcementMode;
  minimumSeverity: Severity;
  failOnIncomplete: boolean;
  blockCategories: ScanAnnotation["category"][];
  ignoredPaths: string[];
  ignoredPackages: string[];
  requireCleanBaseline: boolean;
  suppressions: PolicySuppression[];
  inheritedFrom?: string;
  revision: number;
  signature?: string;
}

export interface PolicyRevisionEnvelope {
  policy: EnforcementPolicy;
  signedAt: string;
  signedBy: string;
  signature: string;
}

export interface PolicyDecision {
  policy: EnforcementPolicy;
  blocking: ScanAnnotation[];
  suppressed: ScanAnnotation[];
  ignored: ScanAnnotation[];
  shouldBlock: boolean;
  verdict: "success" | "failure" | "incomplete";
  reasons: string[];
}

export const DEFAULT_POLICY: EnforcementPolicy = {
  schema: "v1",
  mode: "report",
  minimumSeverity: "failure",
  failOnIncomplete: false,
  blockCategories: ["secret", "execution", "dependency"],
  ignoredPaths: ["**/fixtures/**", "**/vendor/**"],
  ignoredPackages: [],
  requireCleanBaseline: false,
  suppressions: [],
  revision: 1,
};

const categories = new Set<ScanAnnotation["category"]>(["secret", "execution", "dependency"]);
const severities = new Set<Severity>(["warning", "failure"]);

function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "§§").replace(/\*/g, "[^/]*").replace(/§§/g, ".*");
  return new RegExp(`^${escaped}$`);
}

function matchesAny(value: string, patterns: string[]): boolean {
  return patterns.some((pattern) => {
    try { return globToRegExp(pattern).test(value); } catch { return false; }
  });
}

export function validatePolicy(input: unknown, inherited: EnforcementPolicy = DEFAULT_POLICY): EnforcementPolicy {
  if (!input || typeof input !== "object") throw new Error("Policy must be an object");
  const source = input as Record<string, unknown>;
  const schema = source.schema ?? (source.version === 1 ? "v1" : inherited.schema);
  if (schema !== "v1") throw new Error("Unsupported policy schema; expected v1");
  const merged = { ...inherited, ...source, schema: "v1" as const } as EnforcementPolicy;
  if (!new Set(["block", "report"]).has(merged.mode)) throw new Error("Policy mode must be block or report");
  if (!severities.has(merged.minimumSeverity)) throw new Error("Policy minimumSeverity is invalid");
  if (!Array.isArray(merged.blockCategories) || merged.blockCategories.some((category) => !categories.has(category))) throw new Error("Policy blockCategories is invalid");
  for (const field of ["ignoredPaths", "ignoredPackages", "suppressions"] as const) if (!Array.isArray(merged[field])) throw new Error(`Policy ${field} must be an array`);
  for (const suppression of merged.suppressions) {
    if (!suppression.id || !suppression.reason || !suppression.owner || !suppression.expiresAt || Number.isNaN(Date.parse(suppression.expiresAt))) throw new Error(`Invalid suppression ${suppression.id || "unknown"}`);
  }
  return { ...merged, revision: Number.isInteger(merged.revision) && merged.revision > 0 ? merged.revision : inherited.revision };
}

export function mergePolicy(parent: EnforcementPolicy, child: unknown): EnforcementPolicy {
  const childPolicy = validatePolicy(child, parent);
  return validatePolicy({ ...childPolicy, inheritedFrom: `revision:${parent.revision}`, revision: parent.revision + 1 });
}

export function evaluateGate(annotations: ScanAnnotation[], policyInput: Partial<EnforcementPolicy> | EnforcementPolicy = {}): PolicyDecision {
  const policy = validatePolicy({ ...DEFAULT_POLICY, ...policyInput });
  const now = Date.now();
  const suppressed: ScanAnnotation[] = [];
  const ignored: ScanAnnotation[] = [];
  const blocking: ScanAnnotation[] = [];
  const reasons: string[] = [];
  for (const annotation of annotations) {
    if (matchesAny(annotation.path, policy.ignoredPaths) || (annotation.packageName && policy.ignoredPackages.includes(annotation.packageName))) { ignored.push(annotation); continue; }
    const suppression = policy.suppressions.find((item) => (!item.expiresAt || Date.parse(item.expiresAt) >= now) && (!item.fingerprint || item.fingerprint === annotation.fingerprint) && (!item.category || item.category === annotation.category));
    if (suppression) { suppressed.push(annotation); continue; }
    if (policy.blockCategories.includes(annotation.category) && (annotation.severity === policy.minimumSeverity || policy.minimumSeverity === "warning")) blocking.push(annotation);
  }
  if (blocking.length) reasons.push(`${blocking.length} finding(s) match blocking policy categories and severity threshold`);
  const incomplete = policy.failOnIncomplete && annotations.length === 0;
  if (incomplete) reasons.push("Scan incomplete and failOnIncomplete is enabled");
  return { policy, blocking, suppressed, ignored, shouldBlock: policy.mode === "block" && (blocking.length > 0 || incomplete), verdict: incomplete ? "incomplete" : blocking.length > 0 ? "failure" : "success", reasons };
}

export function canonicalPolicy(policy: EnforcementPolicy): string {
  return JSON.stringify({ ...policy, signature: undefined });
}

export function signPolicy(policy: EnforcementPolicy, secret: string, signedBy: string, signedAt = new Date().toISOString()): PolicyRevisionEnvelope {
  if (!secret) throw new Error("Policy signing secret is required");
  const payload = `${signedAt}.${signedBy}.${canonicalPolicy(policy)}`;
  const signature = createHmac("sha256", secret).update(payload).digest("hex");
  return { policy: { ...policy, signature }, signedAt, signedBy, signature };
}

export function verifyPolicySignature(envelope: PolicyRevisionEnvelope, secret: string): boolean {
  if (!secret || !envelope.signature) return false;
  const payload = `${envelope.signedAt}.${envelope.signedBy}.${canonicalPolicy(envelope.policy)}`;
  const expected = createHmac("sha256", secret).update(payload).digest("hex");
  return expected.length === envelope.signature.length && timingSafeEqual(Buffer.from(expected), Buffer.from(envelope.signature));
}

export function policyAuditEvent(policy: EnforcementPolicy, actor: string, action: "created" | "updated" | "inherited" | "evaluated"): Record<string, unknown> {
  return { type: "policy.audit", action, actor, revision: policy.revision, schema: policy.schema, mode: policy.mode, createdAt: new Date().toISOString(), policyDigest: createHmac("sha256", "warden-policy-digest").update(canonicalPolicy(policy)).digest("hex") };
}

export function policyToSarif(decision: PolicyDecision): Record<string, unknown> {
  return { version: "2.1.0", $schema: "https://json.schemastore.org/sarif-2.1.0.json", runs: [{ tool: { driver: { name: "Warden CI", informationUri: "https://warden-ci-dvk5.onrender.com" } }, results: decision.blocking.map((item) => ({ ruleId: item.fingerprint, level: item.severity === "failure" ? "error" : "warning", message: { text: item.message }, locations: [{ physicalLocation: { artifactLocation: { uri: item.path }, region: { startLine: item.line } } }] })) }] };
}

export function policyToCycloneDx(annotations: ScanAnnotation[]): Record<string, unknown> {
  return { bomFormat: "CycloneDX", specVersion: "1.5", version: 1, metadata: { timestamp: new Date().toISOString(), tools: [{ vendor: "Warden", name: "Warden CI" }] }, vulnerabilities: annotations.filter((item) => item.category === "dependency").map((item) => ({ id: item.fingerprint, source: { name: item.ecosystem || "unknown" }, ratings: [{ severity: item.severity === "failure" ? "high" : "medium" }], description: item.message })) };
}
