import { test } from "node:test";
import assert from "node:assert";
import { scoreFile } from "./heuristics";
import { ChangedFile } from "./types";

function makeFile(filename: string, patch: string): ChangedFile {
  return { filename, status: "modified", patch, additions: 0, deletions: 0 };
}

test("clean, ordinary code scores low", () => {
  const patch = [
    "@@ -1,3 +1,6 @@",
    "+function calculateShippingCost(order, region) {",
    "+  const baseRate = region === 'international' ? 12.5 : 4.99;",
    "+  return baseRate + order.weightKg * 0.75;",
    "+}",
  ].join("\n");
  const result = scoreFile(makeFile("shipping.js", patch));
  assert.ok(result.score < 15, `expected low score, got ${result.score}`);
});

test("leaked generation artifact is flagged", () => {
  const patch = [
    "@@ -1,2 +1,2 @@",
    "+// Here's an updated version of the function:",
    "+const apiKey = 'your_api_key_here';",
  ].join("\n");
  const result = scoreFile(makeFile("config.js", patch));
  assert.ok(result.score > 0, "expected non-zero score");
  assert.ok(
    result.findings.some((f) => f.rule === "leaked-generation-artifact"),
    "expected a leaked-generation-artifact finding"
  );
});

test("obvious comments are flagged but weighted lightly", () => {
  const patch = [
    "@@ -1,2 +1,2 @@",
    "+// increment i by 1",
    "+i++;",
  ].join("\n");
  const result = scoreFile(makeFile("loop.js", patch));
  assert.ok(
    result.findings.some((f) => f.rule === "obvious-comment"),
    "expected an obvious-comment finding"
  );
  assert.ok(result.score < 20, `expected a light weight, got ${result.score}`);
});

test("binary or empty patch is skipped, not scored as risky", () => {
  const result = scoreFile(makeFile("image.png", ""));
  assert.strictEqual(result.score, 0);
  assert.ok(result.skipped, "expected file to be marked as skipped");
});

test("duplicate function structure is detected across near-identical bodies", () => {
  const fn = (name: string) =>
    `+function ${name}(req, res) {\n+  const data = req.body;\n+  console.log(data);\n+  res.send(data);\n+}`;
  const patch = ["@@ -1,20 +1,20 @@", fn("a"), fn("b"), fn("c"), fn("d")].join("\n");
  const result = scoreFile(makeFile("routes.js", patch));
  assert.ok(
    result.findings.some((f) => f.rule === "duplicate-function-structure"),
    "expected a duplicate-function-structure finding"
  );
});
