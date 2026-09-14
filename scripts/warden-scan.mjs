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
// GitHub Actions workflow, WARDEN_REPOSITORY_ID and WARDEN_HEAD_SHA are set,
// which lets the API persist this run and return a real per-scan report link.
//
// NOTE: these are deliberately NOT named GITHUB_REPOSITORY_ID / GITHUB_SHA.
// GitHub Actions silently drops any step-level env var whose name starts with
// GITHUB_ (reserved prefix) — a workflow trying to set those would have no
// effect, and GITHUB_SHA in particular already exists as a GitHub-provided
// default that points at a synthetic merge commit on pull_request events, not
// the actual head commit. Using the WARDEN_-prefixed names avoids both traps.
const githubRepositoryId = process.env.WARDEN_REPOSITORY_ID ? Number(process.env.WARDEN_REPOSITORY_ID) : undefined;
const commitSha = process.env.WARDEN_HEAD_SHA || undefined;
// GITHUB_REPOSITORY_OWNER is a GitHub-provided default var — safe to read
// (the reserved-prefix rule only blocks *setting* GITHUB_-prefixed vars in a
// workflow, not GitHub's own built-in ones being read here).
const repoOwner = process.env.GITHUB_REPOSITORY_OWNER || undefined;

const response = await fetch(new URL("/api/scan", baseUrl), {
  method: "POST",
  headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
  body: JSON.stringify({ files, githubRepositoryId, commitSha }),
});
const result = await response.json();

// There is no /dashboard route on the deployed app — only /details?runId=...
// is a real per-run report. If the API didn't return a runId (e.g. no
// repository context was sent, or the API call failed), there is no valid
// report link to give — better to omit it than to hand back a URL that 404s.
const reportUrl = result.runId ? `${publicUrl}/details?runId=${result.runId}` : undefined;
const upgradeUrl = repoOwner ? `${publicUrl}/subscribe?owner=${repoOwner}&plan=pro` : `${publicUrl}/subscribe?plan=pro`;

console.log(JSON.stringify({ ...result, reportUrl, upgradeUrl }, null, 2));

// Hand the resolved report link to the calling shell step. Only written when
// a real report link exists — the workflow checks for this file's presence
// to decide whether to show a report link at all, so writing a broken
// fallback URL here would defeat that check.
if (reportUrl) {
  await fs.writeFile("warden-report-url.txt", reportUrl);
  if (process.env.GITHUB_OUTPUT) {
    await fs.appendFile(process.env.GITHUB_OUTPUT, `report_url=${reportUrl}\n`);
  }
}

process.exit(response.ok && result.verdict !== "fail" ? 0 : 1);
