import assert from "node:assert/strict";
import test from "node:test";
import { createRemediationPullRequest, remediationBranch } from "../dist/remediation/github.js";

const result = { manifestContent: '{"dependencies":{"demo":"1.0.1"}}\n', manifestPath: "package.json", packageName: "demo", from: "^1.0.0", to: "^1.0.1", changedSection: "dependencies" };

test("remediation branch names are deterministic and sanitized", () => {
  assert.equal(remediationBranch("run/id", "finding id"), "warden/fix/run-id/finding-id");
});

test("existing remediation PR is reused without GitHub writes", async () => {
  const octokit = new Proxy({}, { get() { throw new Error("GitHub write should not occur"); } });
  const reused = await createRemediationPullRequest(octokit, { owner: "o", repo: "r", baseBranch: "main", baseSha: "sha", runId: "run", findingId: "finding", reportUrl: "https://warden/report", advisoryId: "GHSA-demo", result, existingPullRequest: { html_url: "https://github.com/o/r/pull/4", number: 4 } });
  assert.deepEqual(reused, { branch: "warden/fix/run/finding", pullRequestUrl: "https://github.com/o/r/pull/4", pullRequestNumber: 4 });
});
