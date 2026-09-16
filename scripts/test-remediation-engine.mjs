import assert from "node:assert/strict";
import test from "node:test";
import { applyDependencyRemediation, manifestDiffIsScoped } from "../dist/remediation/engine.js";

test("bumps npm dependency while preserving section and unrelated entries", () => {
  const before = '{\n  "dependencies": {\n    "lodash": "^4.17.20",\n    "react": "18.3.1"\n  }\n}\n';
  const result = applyDependencyRemediation({ ecosystem: "npm", packageName: "lodash", vulnerableRange: "<4.17.21", targetVersion: "4.17.21", manifestPath: "package.json", manifestContent: before });
  assert.equal(result.changedSection, "dependencies");
  assert.equal(JSON.parse(result.manifestContent).dependencies.lodash, "^4.17.21");
  assert.equal(JSON.parse(result.manifestContent).dependencies.react, "18.3.1");
  assert.equal(manifestDiffIsScoped(before, result.manifestContent, "lodash"), true);
});

test("bumps npm dev dependency", () => {
  const result = applyDependencyRemediation({ ecosystem: "npm", packageName: "typescript", vulnerableRange: "<5.0.0", targetVersion: "5.0.2", manifestPath: "package.json", manifestContent: '{"devDependencies":{"typescript":"~4.9.5"}}' });
  assert.equal(result.changedSection, "devDependencies");
  assert.equal(JSON.parse(result.manifestContent).devDependencies.typescript, "~5.0.2");
});

test("updates supported Python requirement without rewriting unrelated lines", () => {
  const before = "requests==2.31.0\nurllib3>=1.26\n";
  const result = applyDependencyRemediation({ ecosystem: "python", packageName: "requests", vulnerableRange: "<2.32.0", targetVersion: "2.32.3", manifestPath: "requirements.txt", manifestContent: before });
  assert.equal(result.manifestContent, "requests==2.32.3\nurllib3>=1.26\n");
});

for (const [name, input] of [
  ["malformed JSON", { ecosystem: "npm", packageName: "x", vulnerableRange: "<2.0.0", targetVersion: "2.0.0", manifestPath: "package.json", manifestContent: "{" }],
  ["missing package", { ecosystem: "npm", packageName: "x", vulnerableRange: "<2.0.0", targetVersion: "2.0.0", manifestPath: "package.json", manifestContent: "{}" }],
  ["still vulnerable target", { ecosystem: "npm", packageName: "x", vulnerableRange: "<2.0.0", targetVersion: "1.9.0", manifestPath: "package.json", manifestContent: '{"dependencies":{"x":"1.0.0"}}' }],
  ["ambiguous entry", { ecosystem: "npm", packageName: "x", vulnerableRange: "<2.0.0", targetVersion: "2.0.0", manifestPath: "package.json", manifestContent: '{"dependencies":{"x":"1.0.0"},"devDependencies":{"x":"1.0.0"}}' }],
]) test(name, () => assert.throws(() => applyDependencyRemediation(input)));
