import { mkdir, readFile, writeFile } from "node:fs/promises";
import { assessPackage } from "../dist/scan/riskSignals.js";

const datasetPath = process.argv[2] ?? "benchmarks/evaluation/package-risk-v1.json";
const outputPath = process.argv[3] ?? "benchmarks/reports/package-risk-v1.json";
const dataset = JSON.parse(await readFile(new URL(`../${datasetPath}`, import.meta.url), "utf8"));
const metadataByPackage = Object.fromEntries(dataset.fixtures.map((fixture) => [fixture.packageName, fixture.metadata]));
const ecosystem = {
  id: "npm",
  popularPackages: dataset.popularPackages,
  async fetchMetadata(name) { return metadataByPackage[name] ?? { existsOnRegistry: false, lookupStatus: "not_found" }; },
};
const started = performance.now();
const results = [];
for (const fixture of dataset.fixtures) {
  const resultStarted = performance.now();
  const verdict = await assessPackage(fixture.packageName, ecosystem);
  const actual = verdict?.verdict ?? "safe";
  results.push({ ...fixture, actual, latencyMs: Number((performance.now() - resultStarted).toFixed(3)), pass: actual === fixture.expected });
}
const labels = [...new Set(results.map((result) => result.expected))];
const byCategory = Object.fromEntries([...new Set(results.map((result) => result.category))].map((category) => {
  const rows = results.filter((result) => result.category === category);
  return [category, { count: rows.length, passed: rows.filter((row) => row.pass).length, unknown: rows.filter((row) => row.actual === "registry-unavailable").length }];
}));
const safeLabel = "safe";
const positiveLabels = new Set(labels.filter((label) => label !== safeLabel && label !== "registry-unavailable"));
const tp = results.filter((row) => positiveLabels.has(row.expected) && positiveLabels.has(row.actual)).length;
const fp = results.filter((row) => row.expected === safeLabel && positiveLabels.has(row.actual)).length;
const fn = results.filter((row) => positiveLabels.has(row.expected) && row.actual === safeLabel).length;
const tn = results.filter((row) => row.expected === safeLabel && row.actual === safeLabel).length;
const precision = tp + fp ? tp / (tp + fp) : null;
const recall = tp + fn ? tp / (tp + fn) : null;
const report = {
  dataset: dataset.id,
  datasetType: dataset.datasetType,
  evaluationDate: dataset.evaluationDate,
  scanner: "riskSignals",
  fixtureCount: results.length,
  passed: results.filter((row) => row.pass).length,
  failed: results.filter((row) => !row.pass).length,
  confusion: { tp, tn, fp, fn },
  metrics: { precision, recall, f1: precision !== null && recall !== null && precision + recall ? (2 * precision * recall) / (precision + recall) : null, coverage: results.filter((row) => row.actual !== "registry-unavailable").length / results.length, unknownRate: results.filter((row) => row.actual === "registry-unavailable").length / results.length, medianLatencyMs: results.map((row) => row.latencyMs).sort((a, b) => a - b)[Math.floor(results.length / 2)] },
  byCategory,
  elapsedMs: Number((performance.now() - started).toFixed(3)),
  results,
};
await mkdir(new URL(`../${outputPath.substring(0, outputPath.lastIndexOf("/"))}`, import.meta.url), { recursive: true });
await writeFile(new URL(`../${outputPath}`, import.meta.url), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (report.failed > 0) process.exitCode = 1;
