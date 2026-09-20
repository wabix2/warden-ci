import test from "node:test";
import assert from "node:assert/strict";
import { npmEcosystem } from "../dist/scan/ecosystems/npm.js";
import { pypiEcosystem } from "../dist/scan/ecosystems/pypi.js";
import { cargoEcosystem } from "../dist/scan/ecosystems/cargo.js";
import { goEcosystem } from "../dist/scan/ecosystems/go.js";
import { packageIdentity } from "../dist/scan/ecosystems/identity.js";

test("canonicalizes scoped npm identity without losing scope", () => {
  const identity = packageIdentity(npmEcosystem, " @Scope/Package ");
  assert.equal(identity.normalizedName, "@scope/package");
  assert.equal(identity.namespace, "@scope");
  assert.equal(identity.packageManager, "npm");
});

test("marks Python distribution/import ambiguity explicitly", () => {
  const identity = packageIdentity(pypiEcosystem, "Requests_Test");
  assert.equal(identity.normalizedName, "requests-test");
  assert.equal(identity.ambiguous, true);
  assert.match(identity.ambiguityReason ?? "", /import/i);
});

test("keeps Cargo crate names distinct from source imports", () => {
  const identity = packageIdentity(cargoEcosystem, "serde");
  assert.equal(identity.packageManager, "cargo");
  assert.equal(identity.importName, "serde");
});

test("keeps Go module paths exact and marks import context", () => {
  const identity = packageIdentity(goEcosystem, "github.com/acme/widget/v2");
  assert.equal(identity.normalizedName, "github.com/acme/widget/v2");
  assert.equal(identity.sourceReference, "github.com/acme/widget/v2");
  assert.equal(identity.packageManager, "go");
});
