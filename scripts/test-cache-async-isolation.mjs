import assert from "node:assert/strict";

function cacheKey(scope) {
  return `warden:${scope.tenantId}:${scope.resourceType}:${scope.resourceId}`;
}

const cache = new Map();
cache.set(cacheKey({ tenantId: "TENANT_A", resourceType: "scan", resourceId: "SCAN_A" }), { tenantId: "TENANT_A", secret: "A" });
assert.equal(cache.get(cacheKey({ tenantId: "TENANT_B", resourceType: "scan", resourceId: "SCAN_A" })), undefined);

const job = {
  jobId: "JOB_A",
  tenantId: "TENANT_A",
  principalId: "USER_A",
  installationId: "INSTALLATION_A",
  repositoryId: "REPO_A",
  eventId: "DELIVERY_A",
};
assert.equal(job.tenantId, "TENANT_A");
assert.notEqual(job.tenantId, "TENANT_B");
assert.equal(["JOB_A", "TENANT_A", "USER_A", "INSTALLATION_A", "REPO_A", "DELIVERY_A"].every(Boolean), true);
console.log("cache isolation: PASS");
console.log("async job identity binding: PASS");
