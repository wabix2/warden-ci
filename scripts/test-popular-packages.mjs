import assert from "node:assert/strict";
import test from "node:test";
import { POPULAR_NPM_PACKAGES, POPULAR_PYPI_PACKAGES } from "../dist/scan/popularPackages.js";
import { getBootstrapSnapshot, refreshPopularPackages } from "../dist/scan/popularPackageRefresh.js";

function fakeFetch(downloadsByName, fail = false) {
  return async (input) => {
    if (fail) throw new Error("registry unavailable");
    const url = String(input);
    const name = url.includes("pypistats")
      ? decodeURIComponent(url.split("/packages/")[1].split("/")[0])
      : decodeURIComponent(url.split("/").pop());
    return { ok: true, json: async () => ({ downloads: downloadsByName[name] ?? 0, data: { last_month: { downloads: downloadsByName[name] ?? 0 } } }) };
  };
}

test("refresh publishes ranked npm and PyPI snapshots", async () => {
  const result = await refreshPopularPackages({
    fetchImpl: fakeFetch({ alpha: 10, beta: 30, gamma: 20 }),
    npmCandidates: ["alpha", "beta", "gamma"],
    pypiCandidates: ["alpha", "beta", "gamma"],
    now: () => 0,
  });
  assert.equal(result?.source, "live");
  assert.deepEqual(result?.npm, ["beta", "gamma", "alpha"]);
  assert.deepEqual(POPULAR_NPM_PACKAGES.slice(0, 3), ["beta", "gamma", "alpha"]);
});

test("refresh failure retains the last-known-good arrays", async () => {
  const before = [...POPULAR_NPM_PACKAGES];
  const result = await refreshPopularPackages({ fetchImpl: fakeFetch({}, true), npmCandidates: ["alpha"], pypiCandidates: ["alpha"] });
  assert.equal(result, null);
  assert.deepEqual(POPULAR_NPM_PACKAGES, before);
});

test("bootstrap snapshot is an isolated fallback", () => {
  const snapshot = getBootstrapSnapshot(0);
  snapshot.npm.push("test-only");
  assert.notEqual(POPULAR_NPM_PACKAGES.at(-1), "test-only");
  assert.equal(snapshot.source, "bootstrap");
});

void POPULAR_PYPI_PACKAGES;
