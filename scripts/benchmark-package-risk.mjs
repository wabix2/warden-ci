import { readFile } from "node:fs/promises";
import { assessPackage } from "../dist/scan/riskSignals.js";

const fixtures = JSON.parse(await readFile(new URL("../benchmarks/package-risk-fixtures.json", import.meta.url), "utf8"));
const popular = ["react", "express"];
const metadata = {
  "react": { existsOnRegistry: true, lookupStatus: "ok", latestVersion: "18.3.1" },
  "warden-ai-generated-package-does-not-exist": { existsOnRegistry: false, lookupStatus: "not_found" },
  "recat": { existsOnRegistry: true, lookupStatus: "ok", publishedDaysAgo: 5 },
  "internal-utils": { existsOnRegistry: true, lookupStatus: "ok", latestVersion: "10.0.0", releaseCount: 1, latestReleaseDaysAgo: 3 },
  "express": { existsOnRegistry: true, lookupStatus: "ok", publisherChangedRecently: true, publisherHistory: ["old", "new"], latestReleaseDaysAgo: 4 },
  "registry-timeout": { existsOnRegistry: false, lookupStatus: "unavailable" }
};

const ecosystem = { id: "npm", popularPackages: popular, async fetchMetadata(name) { return metadata[name] ?? { existsOnRegistry: false, lookupStatus: "not_found" }; } };
const results = [];
for (const fixture of fixtures) {
  let actual = "unknown";
  try { actual = (await assessPackage(fixture.packageName, ecosystem))?.verdict ?? "safe"; } catch { actual = "error"; }
  results.push({ ...fixture, actual, pass: actual === fixture.expected });
}
const passed = results.filter((result) => result.pass).length;
console.log(JSON.stringify({ scanner: "riskSignals", fixtureCount: results.length, passed, failed: results.length - passed, results }, null, 2));
if (passed !== results.length) process.exitCode = 1;
