import assert from "node:assert/strict";

const records = new Map([
  ["SUBSCRIPTION_A", { tenantId: "TENANT_A", status: "active", plan: "pro" }],
  ["SUBSCRIPTION_B", { tenantId: "TENANT_B", status: "active", plan: "pro" }],
]);

function canUsePremium(principalTenant, subscriptionId, clientPlan) {
  const record = records.get(subscriptionId);
  if (!record || record.tenantId !== principalTenant) return false;
  if (clientPlan) return false;
  return record.status === "active" && record.plan !== "free";
}

assert.equal(canUsePremium("TENANT_A", "SUBSCRIPTION_A", undefined), true);
assert.equal(canUsePremium("TENANT_A", "SUBSCRIPTION_B", undefined), false);
assert.equal(canUsePremium("TENANT_B", "SUBSCRIPTION_A", undefined), false);
assert.equal(canUsePremium("TENANT_A", "SUBSCRIPTION_A", "enterprise"), false);
assert.equal(canUsePremium("TENANT_A", "UNKNOWN", undefined), false);
console.log("billing authority and tenant binding: PASS");
