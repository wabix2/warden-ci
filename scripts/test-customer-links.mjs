import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const workflow = fs.readFileSync(".github/workflows/warden-scan.yml", "utf8");
const report = fs.readFileSync("report.html", "utf8");
const server = fs.readFileSync("src/server.ts", "utf8");
const scan = fs.readFileSync("scripts/warden-scan.mjs", "utf8");

test("customer links use Warden routes, not GitHub destinations", () => {
  assert.match(workflow, /https:\/\/warden-ci-dvk5\.onrender\.com\/dashboard/);
  assert.match(workflow, /https:\/\/warden-ci-dvk5\.onrender\.com\/subscribe\?plan=pro/);
  assert.doesNotMatch(workflow, /github\.com|WARDEN_PUBLIC_URL/);
  assert.match(report, /href="\/subscribe\?plan=pro"/);
  assert.match(server, /res\.redirect\(302, "\/subscribe\?plan=pro"\)/);
  assert.match(scan, /customerDashboardUrl/);
  assert.match(scan, /subscribe\?plan=pro/);
  assert.equal((server.match(/app\.get\("\/subscribe"/g) || []).length, 1);
  assert.equal((server.match(/app\.get\("\/health"/g) || []).length, 1);
});
