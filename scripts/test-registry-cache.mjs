import assert from "node:assert/strict";
import test from "node:test";
import { scanFiles } from "../dist/scan/index.js";
import { resetMetadataCacheForTests } from "../dist/scan/ecosystems/registry.js";

test("repeated webhook scans use one registry lookup per package", async () => {
  resetMetadataCacheForTests();
  const originalFetch = globalThis.fetch;
  let registryCalls = 0;
  globalThis.fetch = async (input) => { if (String(input).includes("registry.npmjs.org")) registryCalls += 1; return new Response(JSON.stringify({ time: { created: new Date().toISOString(), modified: new Date().toISOString() }, "dist-tags": { latest: "1.0.0" }, versions: { "1.0.0": {} } }), { status: 200, headers: { "content-type": "application/json" } }); };
  try {
    const files = [{ filename: "src/a.ts", patch: "+import x from 'same-package';\n+import y from 'same-package';" }];
    await scanFiles(files);
    await scanFiles(files);
    assert.equal(registryCalls, 1);
  } finally { globalThis.fetch = originalFetch; resetMetadataCacheForTests(); }
});
