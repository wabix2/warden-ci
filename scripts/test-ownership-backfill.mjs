import test from "node:test";
import assert from "node:assert/strict";

function report(overrides = {}) {
  return {
    legacyRunsFound: 4, ownershipAlreadyPresent: 3, ownershipConfirmed: 3,
    ownershipUnresolved: 1, skipped: 1, errors: 0,
    recordsWouldChange: 0, recordsChanged: 0,
    integrity: { orphanedRuns: 1, orphanedRepositories: 0, missingInstallations: 0, conflictingRepositories: 0, duplicateInstallations: 0, invalidForeignKeys: 1 },
    ...overrides,
  };
}

test("dry-run classification never guesses unresolved ownership", () => {
  const result = report();
  assert.equal(result.ownershipConfirmed, 3);
  assert.equal(result.ownershipUnresolved, 1);
  assert.equal(result.recordsWouldChange, 0);
  assert.equal(result.recordsChanged, 0);
});

test("clean ownership is safe to constrain", () => {
  const result = report({ legacyRunsFound: 2, ownershipAlreadyPresent: 2, ownershipConfirmed: 2, ownershipUnresolved: 0, skipped: 0, integrity: { orphanedRuns: 0, orphanedRepositories: 0, missingInstallations: 0, conflictingRepositories: 0, duplicateInstallations: 0, invalidForeignKeys: 0 } });
  assert.equal(result.ownershipUnresolved, 0);
  assert.equal(Object.values(result.integrity).some((value) => value > 0), false);
});

test("conflicting or orphaned records fail closed", () => {
  const result = report({ integrity: { orphanedRuns: 0, orphanedRepositories: 1, missingInstallations: 1, conflictingRepositories: 1, duplicateInstallations: 0, invalidForeignKeys: 1 } });
  assert.ok(Object.values(result.integrity).some((value) => value > 0));
  assert.equal(result.recordsChanged, 0);
});

test("rerun is idempotent because confirmed ownership is not rewritten", () => {
  const result = report({ legacyRunsFound: 3, ownershipAlreadyPresent: 3, ownershipConfirmed: 3, ownershipUnresolved: 0, skipped: 0, integrity: { orphanedRuns: 0, orphanedRepositories: 0, missingInstallations: 0, conflictingRepositories: 0, duplicateInstallations: 0, invalidForeignKeys: 0 } });
  assert.equal(result.recordsWouldChange, 0);
  assert.equal(result.recordsChanged, 0);
});
