import { readFile, writeFile } from "node:fs/promises";

const input = process.argv[2] ?? "benchmarks/reports/package-risk-v1.json";
const output = process.argv[3] ?? "benchmarks/reports/package-risk-v1.md";
const report = JSON.parse(await readFile(new URL(`../${input}`, import.meta.url), "utf8"));
const metrics = report.metrics;
const lines = [
  `# ${report.dataset}`,
  "",
  `- Dataset type: ${report.datasetType}`,
  `- Evaluation date: ${report.evaluationDate}`,
  `- Provenance: ${report.provenance.source}`,
  `- Fixtures: ${report.fixtureCount}; passed: ${report.passed}; failed: ${report.failed}`,
  "",
  "## Metrics",
  "",
  "| Metric | Value |",
  "|---|---:|",
  `| TP | ${report.confusion.tp} |`,
  `| TN | ${report.confusion.tn} |`,
  `| FP | ${report.confusion.fp} |`,
  `| FN | ${report.confusion.fn} |`,
  `| Precision | ${metrics.precision ?? "NOT MEASURED"} |`,
  `| Recall | ${metrics.recall ?? "NOT MEASURED"} |`,
  `| F1 | ${metrics.f1 ?? "NOT MEASURED"} |`,
  `| Specificity | ${metrics.specificity ?? "NOT MEASURED"} |`,
  `| False-positive rate | ${metrics.falsePositiveRate ?? "NOT MEASURED"} |`,
  `| False-negative rate | ${metrics.falseNegativeRate ?? "NOT MEASURED"} |`,
  `| Coverage | ${metrics.coverage} |`,
  `| UNKNOWN rate | ${metrics.unknownRate} |`,
  `| Registry-unavailable rate | ${metrics.registryUnavailableRate} |`,
  `| Latency p50/p95/p99 | ${metrics.latencyMs.p50} / ${metrics.latencyMs.p95} / ${metrics.latencyMs.p99} ms |`,
  "",
  "## Limitations",
  "",
  "This report is only as representative as its labeled corpus. Synthetic fixtures and recorded metadata are not evidence of production accuracy. UNKNOWN cases are excluded from safe/unsafe confusion counts.",
  "",
];
await writeFile(new URL(`../${output}`, import.meta.url), `${lines.join("\n")}\n`);
console.log(lines.join("\n"));
