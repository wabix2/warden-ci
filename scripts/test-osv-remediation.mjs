import assert from "node:assert/strict";
import test from "node:test";
import { resolveOsvAdvisory } from "../dist/remediation/osv.js";

test("OSV resolves a fixed npm version without network", async () => {
  const advisory = await resolveOsvAdvisory("npm", "demo", "1.0.0", async (_url, init) => {
    const request = JSON.parse(init.body);
    assert.deepEqual(request.package, { name: "demo", ecosystem: "npm" });
    assert.equal(request.version, "1.0.0");
    return new Response(JSON.stringify({ vulns: [{ id: "GHSA-demo", affected: [{ package: { name: "demo", ecosystem: "npm" }, ranges: [{ events: [{ introduced: "0", fixed: "1.0.1" }] }] }] }] }), { status: 200 });
  });
  assert.equal(advisory?.fixedVersion, "1.0.1");
  assert.equal(advisory?.id, "GHSA-demo");
});

test("OSV returns unavailable when no fixed version exists", async () => {
  const advisory = await resolveOsvAdvisory("python", "demo", "1.0.0", async () => new Response(JSON.stringify({ vulns: [{ id: "PYSEC-demo", affected: [{ package: { name: "demo", ecosystem: "PyPI" }, ranges: [{ events: [{ introduced: "0" }] }] }] }] }), { status: 200 }));
  assert.equal(advisory, null);
});

test("OSV errors are not converted into a successful remediation", async () => {
  await assert.rejects(() => resolveOsvAdvisory("npm", "demo", "1.0.0", async () => new Response(null, { status: 503 })));
});
