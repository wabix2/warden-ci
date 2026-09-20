import test from "node:test";
import assert from "node:assert/strict";
import { npmEcosystem } from "../dist/scan/ecosystems/npm.js";
import { assessPackage } from "../dist/scan/riskSignals.js";

const names = ["", "../secret", "a".repeat(4096), "раypal", "@scope/", "%2e%2e%2f"];
for (const name of names) {
  test(`malformed registry input remains bounded: ${name.slice(0, 20)}`, async () => {
    const result = await assessPackage(name, { ...npmEcosystem, async fetchMetadata() { return { existsOnRegistry: false, lookupStatus: "not_found" }; } });
    assert.equal(result?.verdict, "hallucinated");
  });
}

test("registry outage is never converted to safe", async () => {
  const result = await assessPackage("slow-registry", { ...npmEcosystem, async fetchMetadata() { return { existsOnRegistry: false, lookupStatus: "unavailable" }; } });
  assert.equal(result?.verdict, "registry-unavailable");
});
