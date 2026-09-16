import assert from "node:assert/strict";
import test from "node:test";
import { queryMalwareAdvisories, osvEcosystemFor } from "../dist/scan/advisories.js";
import { scanFiles } from "../dist/scan/index.js";

const batchResponse = (perQueryVulns) =>
  new Response(JSON.stringify({ results: perQueryVulns.map((vulns) => ({ vulns })) }), { status: 200 });

const vulnDetail = (overrides = {}) =>
  new Response(
    JSON.stringify({ summary: "Malicious code in evil-pkg", references: [{ type: "ADVISORY", url: "https://osv.dev/vulnerability/MAL-2024-1" }], aliases: ["CVE-2024-9999"], ...overrides }),
    { status: 200 }
  );

test("maps Warden ecosystem ids to OSV ecosystem names", () => {
  assert.equal(osvEcosystemFor("npm"), "npm");
  assert.equal(osvEcosystemFor("pypi"), "PyPI");
  assert.equal(osvEcosystemFor("crates.io"), "crates.io");
  assert.equal(osvEcosystemFor("rubygems.org"), "RubyGems");
  assert.equal(osvEcosystemFor("unknown"), undefined);
});

test("flags only packages carrying a MAL- advisory and enriches them", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push(url);
    if (url.endsWith("/querybatch")) {
      const body = JSON.parse(init.body);
      assert.deepEqual(body.queries.map((q) => q.package.name), ["safe-pkg", "evil-pkg"]);
      assert.equal(body.queries[0].package.ecosystem, "npm");
      // safe-pkg: an ordinary CVE (not malware) -> ignored. evil-pkg: a MAL advisory.
      return batchResponse([[{ id: "GHSA-xxxx" }], [{ id: "MAL-2024-1" }]]);
    }
    return vulnDetail();
  };

  const advisories = await queryMalwareAdvisories(["safe-pkg", "evil-pkg"], "npm", fetchImpl);
  assert.equal(advisories.has("safe-pkg"), false);
  const hit = advisories.get("evil-pkg");
  assert.equal(hit?.osvId, "MAL-2024-1");
  assert.equal(hit?.summary, "Malicious code in evil-pkg");
  assert.equal(hit?.reference, "https://osv.dev/vulnerability/MAL-2024-1");
  assert.ok(calls.some((u) => u.includes("/vulns/MAL-2024-1")));
});

test("network failure fails open (no advisories, no throw)", async () => {
  const advisories = await queryMalwareAdvisories(["anything"], "npm", async () => new Response(null, { status: 503 }));
  assert.equal(advisories.size, 0);
});

test("empty package set short-circuits without a network call", async () => {
  let called = false;
  await queryMalwareAdvisories([], "npm", async () => {
    called = true;
    return batchResponse([]);
  });
  assert.equal(called, false);
});

test("scanFiles emits a blocking finding for a known-malware dependency", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const href = typeof url === "string" ? url : url.url;
    if (href.includes("api.osv.dev/v1/querybatch")) return batchResponse([[{ id: "MAL-2024-1" }]]);
    if (href.includes("api.osv.dev/v1/vulns/")) return vulnDetail();
    // npm packument lookup for the metadata pass — package "exists".
    return new Response(JSON.stringify({ time: { created: "2024-01-01T00:00:00Z" }, "dist-tags": { latest: "1.0.0" }, versions: {} }), { status: 200 });
  };
  try {
    const patch = "@@ -0,0 +1 @@\n+import evil from 'evil-pkg'";
    const result = await scanFiles([{ filename: "app.ts", patch }], { mode: "block", minimumSeverity: "warning", blockCategories: ["dependency"] });
    const malware = result.annotations.find((a) => a.title === "Known malicious package");
    assert.ok(malware, "expected a known-malware annotation");
    assert.equal(malware.severity, "failure");
    assert.equal(malware.category, "dependency");
    assert.match(malware.fingerprint, /:malware:MAL-2024-1$/);
    assert.equal(result.verdict, "fail");
    assert.ok(result.packageFlags.some((f) => f.verdict === "known-malware" && f.packageName === "evil-pkg"));
  } finally {
    globalThis.fetch = realFetch;
  }
});
