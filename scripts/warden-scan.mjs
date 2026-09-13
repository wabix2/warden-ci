#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

const baseUrl = (process.env.WARDEN_URL || "https://warden-ci-dvk5.onrender.com").replace(/\/$/, "");
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

const response = await fetch(new URL("/api/scan", baseUrl), {
  method: "POST",
  headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
  body: JSON.stringify({ files }),
});
const result = await response.json();
console.log(JSON.stringify({ ...result, customerReportUrl: `${baseUrl.replace(/\/$/, "")}/details?runId=${process.env.GITHUB_RUN_ID || "latest"}`, upgradeUrl: `${baseUrl.replace(/\/$/, "")}/upgrade` }, null, 2));
process.exit(response.ok && result.verdict !== "fail" ? 0 : 1);
