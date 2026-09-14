import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const workflow = fs.readFileSync(".github/workflows/warden-scan.yml", "utf8");
const report = fs.readFileSync("report.html", "utf8");
const server = fs.readFileSync("src/server.ts", "utf8");
const scan = fs.readFileSync("scripts/warden-scan.mjs", "utf8");

test("customer links use Warden routes, not GitHub destinations", () => {
  // No fake /dashboard route — only /details?runId=... is real, and the
  // workflow now omits the report link entirely when no runId is available
  // rather than pointing at a route that doesn't exist.
  assert.doesNotMatch(workflow, /onrender\.com\/dashboard/);
  // Upgrade link must carry the owner, which /subscribe requires per BILLING_SETUP.md.
  assert.match(workflow, /https:\/\/warden-ci-dvk5\.onrender\.com\/subscribe\?owner=\$\{\{ github\.repository_owner \}\}&plan=pro/);
  assert.doesNotMatch(workflow, /github\.com|WARDEN_PUBLIC_URL/);
  // The reserved GITHUB_ prefix must never be used for values the workflow sets itself.
  assert.doesNotMatch(workflow, /GITHUB_REPOSITORY_ID:|GITHUB_SHA:/);
  assert.match(report, /href="\/subscribe\?plan=pro"/);
  assert.match(server, /res\.redirect\(302, "\/subscribe\?plan=pro"\)/);
  // customerDashboardUrl was removed — it only ever pointed at the fake /dashboard route.
  assert.doesNotMatch(scan, /customerDashboardUrl/);
  assert.doesNotMatch(scan, /\/dashboard/);
  assert.match(scan, /subscribe\?plan=pro/);
  assert.equal((server.match(/app\.get\("\/subscribe"/g) || []).length, 1);
  assert.equal((server.match(/app\.get\("\/health"/g) || []).length, 1);
});
