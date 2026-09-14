import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_POLICY, evaluateGate, mergePolicy, policyToCycloneDx, policyToSarif, signPolicy, validatePolicy, verifyPolicySignature } from "../dist/enforcement/policy.js";

const finding = (overrides = {}) => ({ path: "src/app.ts", line: 4, message: "secret", title: "Possible hardcoded secret", severity: "failure", category: "secret", confidence: "high", remediation: "rotate", fingerprint: "secret:src/app.ts:4", ...overrides });

test("new repositories default to report mode", () => {
  assert.equal(DEFAULT_POLICY.mode, "report");
  assert.equal(evaluateGate([finding()]).shouldBlock, false);
});

test("blocking policy honors paths and expiring suppressions", () => {
  const policy = validatePolicy({ mode: "block", ignoredPaths: ["**/fixtures/**"], suppressions: [{ id: "s1", fingerprint: "secret:src/app.ts:4", reason: "tracked", owner: "sec", expiresAt: "2099-01-01T00:00:00.000Z" }] });
  const result = evaluateGate([finding(), finding({ path: "test/fixtures/sample.ts", fingerprint: "other" })], policy);
  assert.equal(result.blocking.length, 0);
  assert.equal(result.suppressed.length, 1);
  assert.equal(result.ignored.length, 1);
});

test("policy inheritance increments revision", () => {
  const child = mergePolicy(DEFAULT_POLICY, { mode: "block", ignoredPackages: ["internal-lib"] });
  assert.equal(child.revision, 2);
  assert.equal(child.inheritedFrom, "revision:1");
});

test("signed revisions verify and reject tampering", () => {
  const envelope = signPolicy(DEFAULT_POLICY, "test-secret", "security@example.com");
  assert.equal(verifyPolicySignature(envelope, "test-secret"), true);
  assert.equal(verifyPolicySignature({ ...envelope, policy: { ...envelope.policy, mode: "block" } }, "test-secret"), false);
});

test("policy exports produce standard formats", () => {
  const decision = evaluateGate([finding()], { mode: "block" });
  assert.equal(policyToSarif(decision).version, "2.1.0");
  assert.equal(policyToCycloneDx([finding()]).bomFormat, "CycloneDX");
});
