#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

const baseUrl = (process.env.WARDEN_URL || "https://warden-ci-dvk5.onrender.com").replace(/\/$/, "");
const publicUrl = "https://warden-ci-dvk5.onrender.com";
const token = process.env.WARDEN_API_TOKEN;
if (!baseUrl || !token) {
  console.error("Set WARDEN_URL and WARDEN_API_TOKEN before running warden-scan.");
  process.exit(2);
}

const files = [];
for (const filename of process.argv.slice(2)) {
  const absolute = path.resolve(filename);
  const patch = await fs.readFile(absolute, "utf8");
  files.push({ filename, patch });
}
if (files.length === 0) {
  console.error("Usage: node scripts/warden-scan.mjs path/to/diff.patch [...files]");
  process.exit(2);
}

// These are optional: when running as a plain local/editor scan, there's no
// repository context to attach a persisted report to, and that's fine — the
// scan/gate result below doesn't depend on it. When run from the reference
// GitHub Actions workflow, GITHUB_REPOSITORY_ID and GITHUB_SHA are set, which
// lets the API persist this run and return a real per-scan report link
// instead of falling back to the generic dashboard.
const githubRepositoryId = process.env.GITHUB_REPOSITORY_ID ? Number(process.env.GITHUB_REPOSITORY_ID) : undefined;
const commitSha = process.env.GITHUB_SHA || undefined;

const response = await fetch(new URL("/api/scan", baseUrl), {
  method: "POST",
  headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
  body: JSON.stringify({ files, githubRepositoryId, commitSha }),
});
const result = await response.json();
const reportUrl = result.runId ? `${publicUrl}/details?runId=${result.runId}` : `${publicUrl}/dashboard`;
console.log(JSON.stringify({ ...result, customerDashboardUrl: `${publicUrl}/dashboard`, reportUrl, upgradeUrl: `${publicUrl}/subscribe?plan=pro` }, null, 2));

// Hand the resolved report link to the calling shell step. Written to both
// a local file (readable within the same `run:` block, regardless of
// GITHUB_OUTPUT/GITHUB_ENV step-boundary semantics) and GITHUB_OUTPUT (for
// anyone who'd rather reference it from a later step via steps.<id>.outputs).
await fs.writeFile("warden-report-url.txt", reportUrl);
if (process.env.GITHUB_OUTPUT) {
  await fs.appendFile(process.env.GITHUB_OUTPUT, `report_url=${reportUrl}\n`);
}

process.exit(response.ok && result.verdict !== "fail" ? 0 : 1);
