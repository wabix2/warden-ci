import assert from "node:assert/strict";
import test from "node:test";
import { cargoEcosystem, extractCargoManifestPackages } from "../dist/scan/ecosystems/cargo.js";
import { ECOSYSTEMS, assertUniqueExtensions } from "../dist/scan/index.js";
import { assessPackage } from "../dist/scan/riskSignals.js";
import { unavailableMetadata } from "../dist/scan/ecosystems/registry.js";

test("Cargo.toml dependencies are parsed with TOML", () => {
  const packages = extractCargoManifestPackages("[package]\nname = \"demo\"\n[dependencies]\nknown-nonexistent-crate-warden = \"1\"\n");
  assert.ok(packages.has("known-nonexistent-crate-warden"));
  assert.deepEqual(cargoEcosystem.extractPackages([{ line: 3, content: "[dependencies]" }, { line: 4, content: "known-nonexistent-crate-warden = \"1\"" }]).has("known-nonexistent-crate-warden"), true);
});

test("Cargo manifest package is flagged when absent from crates.io", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("not found", { status: 404 });
  try {
    const verdict = await assessPackage("known-nonexistent-crate-warden", cargoEcosystem);
    assert.equal(verdict?.verdict, "hallucinated");
  } finally { globalThis.fetch = originalFetch; }
});

test("only one ecosystem owns each file extension", () => {
  assert.doesNotThrow(() => assertUniqueExtensions(ECOSYSTEMS));
  assert.equal(ECOSYSTEMS.filter((ecosystem) => ecosystem.id === "cargo").length, 1);
});

test("registry failures have one labeled shape", () => {
  assert.deepEqual(unavailableMetadata(), { existsOnRegistry: false, lookupStatus: "unavailable" });
});

test("all registered adapters expose a current status list", () => {
  assert.ok(ECOSYSTEMS.length >= 5);
  for (const ecosystem of ECOSYSTEMS) assert.ok(Array.isArray(ecosystem.popularPackages));
});
