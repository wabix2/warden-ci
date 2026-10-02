import assert from "node:assert/strict";

const baseUrl = process.env.WARDEN_STAGING_URL;
const tokenA = process.env.WARDEN_STAGING_TOKEN_A;
const tokenB = process.env.WARDEN_STAGING_TOKEN_B;

if (!baseUrl || !tokenA || !tokenB) {
  console.error("BLOCKED: set WARDEN_STAGING_URL, WARDEN_STAGING_TOKEN_A, and WARDEN_STAGING_TOKEN_B for controlled staging resources.");
  process.exit(2);
}

const cases = JSON.parse(process.env.WARDEN_STAGING_IDOR_CASES || "[]");
if (!Array.isArray(cases) || cases.length === 0) {
  console.error("BLOCKED: provide WARDEN_STAGING_IDOR_CASES as a JSON array of controlled A/B resource cases.");
  process.exit(2);
}

async function request(path, token, options = {}) {
  const response = await fetch(new URL(path, baseUrl), {
    ...options,
    headers: { authorization: `Bearer ${token}`, ...(options.headers || {}) },
  });
  const text = await response.text();
  return { status: response.status, body: text, headers: response.headers };
}

for (const testCase of cases) {
  const positive = await request(testCase.pathA, tokenA, { method: testCase.method || "GET" });
  assert.ok(testCase.allowedStatuses.includes(positive.status), `${testCase.name}: A->A expected allowed status, got ${positive.status}`);
  const cross = await request(testCase.pathB, tokenA, { method: testCase.method || "GET", body: testCase.body, headers: testCase.body ? { "content-type": "application/json" } : undefined });
  assert.ok(testCase.deniedStatuses.includes(cross.status), `${testCase.name}: A->B expected denial, got ${cross.status}`);
  assert.equal(cross.body.includes(testCase.forbiddenMarker || "__TENANT_B_SECRET__"), false, `${testCase.name}: cross-tenant body leak`);
  console.log(JSON.stringify({ name: testCase.name, positive: positive.status, crossTenant: cross.status, result: "PASS" }));
}
