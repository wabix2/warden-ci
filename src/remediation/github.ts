import { createHash } from "node:crypto";
import type { Octokit } from "@octokit/rest";
import type { RemediationResult } from "./engine";

export function remediationBranch(runId: string, findingId: string): string {
  const safe = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 48);
  return `warden/fix/${safe(runId)}/${safe(findingId)}`;
}

export async function createRemediationPullRequest(octokit: Octokit, input: { owner: string; repo: string; baseBranch: string; baseSha: string; runId: string; findingId: string; reportUrl: string; advisoryId: string; result: RemediationResult; existingPullRequest?: { html_url?: string; number?: number } }): Promise<{ branch: string; pullRequestUrl: string; pullRequestNumber: number }> {
  if (input.existingPullRequest?.html_url && input.existingPullRequest.number) return { branch: remediationBranch(input.runId, input.findingId), pullRequestUrl: input.existingPullRequest.html_url, pullRequestNumber: input.existingPullRequest.number };
  const branch = remediationBranch(input.runId, input.findingId);
  const ref = await octokit.git.getRef({ owner: input.owner, repo: input.repo, ref: `heads/${input.baseBranch}` });
  if (ref.data.object.sha !== input.baseSha) throw new Error("Base branch changed; remediation is stale");
  const existingRef = await octokit.git.getRef({ owner: input.owner, repo: input.repo, ref: `heads/${branch}` }).catch(() => null);
  if (existingRef) throw new Error("Remediation branch already exists");
  await octokit.git.createRef({ owner: input.owner, repo: input.repo, ref: `refs/heads/${branch}`, sha: input.baseSha });
  const current = await octokit.repos.getContent({ owner: input.owner, repo: input.repo, path: input.result.manifestPath, ref: input.baseSha });
  if (Array.isArray(current.data) || !("sha" in current.data)) throw new Error("Manifest is not a file");
  const commit = await octokit.repos.createOrUpdateFileContents({ owner: input.owner, repo: input.repo, path: input.result.manifestPath, branch, message: `chore: remediate ${input.result.packageName} vulnerability`, content: Buffer.from(input.result.manifestContent).toString("base64"), sha: current.data.sha });
  const pr = await octokit.pulls.create({ owner: input.owner, repo: input.repo, title: `fix: update ${input.result.packageName} to ${input.result.to}`, head: branch, base: input.baseBranch, body: [`Warden generated dependency remediation.`, `- Dependency: \`${input.result.packageName}\``, `- Previous: \`${input.result.from}\``, `- Target: \`${input.result.to}\``, `- Advisory: ${input.advisoryId}`, `- Report: ${input.reportUrl}`, `- Manifest validation: passed`, `- Commit: ${commit.data.commit.sha || createHash("sha256").update(input.result.manifestContent).digest("hex")}`].join("\n") });
  return { branch, pullRequestUrl: pr.data.html_url, pullRequestNumber: pr.data.number };
}
