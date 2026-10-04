import { performance } from "node:perf_hooks";
import { assessPackage } from "../dist/scan/riskSignals.js";

const sizes = [1, 10, 100, 1000];
const ecosystem = { id: "npm", popularPackages: [], async fetchMetadata(name) { return { existsOnRegistry: true, lookupStatus: "ok", latestVersion: "1.0.0", releaseCount: 5, publishedDaysAgo: 400, publisherHistory: ["trusted"], latestPublisher: "trusted", latestReleaseDaysAgo: 400 }; } };
const reports = [];
for (const size of sizes) {
  const started = performance.now();
  await Promise.all(Array.from({ length: size }, (_, index) => assessPackage(`fixture-${index}`, ecosystem)));
  reports.push({ packageCount: size, elapsedMs: Number((performance.now() - started).toFixed(3)) });
}
console.log(JSON.stringify({ benchmark: "local-risk-assessment-workload", generatedAt: new Date().toISOString(), reports, limitations: ["does not measure network latency", "does not represent production hardware", "does not establish an SLA"] }, null, 2));
