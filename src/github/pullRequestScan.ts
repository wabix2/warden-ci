import { eq } from "drizzle-orm";
import { getInstallationClient } from "./appAuth";
import { db } from "../db";
import { installations, repositories, scanRuns, findings } from "../db/schema";
import { scanFiles, type ScanAnnotation } from "../scan";
import { isProActive } from "../billing/store";
import { corpusLoggingAllowed, logCorpusEvent } from "../telemetry/corpusLog";
import { CANONICAL_BASE_URL } from "../lib/publicUrl";
import type { EnforcementPolicy } from "../enforcement/policy";

const CHECK_NAME = "Warden CI";
const MAX_ANNOTATIONS = 50; // GitHub accepts at most 50 annotations per request

export interface PullRequestScanDeps {
  loadPolicy: (installationUuid: string) => Promise<EnforcementPolicy>;
}

function summarize(annotations: ScanAnnotation[], filesScanned: number, filesSkipped: number): string {
  const skipped = filesSkipped > 0 ? `\n\n_${filesSkipped} file(s) were skipped (binary, or too large for GitHub to provide a diff)._` : "";
  if (annotations.length === 0) {
    return `Scanned ${filesScanned} changed file(s). No unverified packages, hardcoded secrets, or dangerous dynamic execution found in the added code.${skipped}`;
  }
  const counts = new Map<string, number>();
  for (const a of annotations) counts.set(a.title, (counts.get(a.title) ?? 0) + 1);
  const parts = Array.from(counts.entries()).map(([title, n]) => `${n} x ${title}`);
  const capped = annotations.length > MAX_ANNOTATIONS ? `\n\nShowing the first ${MAX_ANNOTATIONS} annotations; see the full report for the rest.` : "";
  return `Found ${parts.join(", ")} across ${filesScanned} scanned file(s).${capped}${skipped}`;
}

export async function runPullRequestScan(payload: any, deliveryId: string, deps: PullRequestScanDeps): Promise<void> {
  const installationId = payload?.installation?.id;
  const owner = payload?.repository?.owner?.login;
  const repo = payload?.repository?.name;
  const headSha = payload?.pull_request?.head?.sha;
  const prNumber = payload?.pull_request?.number;
  if (!installationId || !owner || !repo || !headSha || !prNumber) {
    throw new Error("Webhook payload is missing installation, repository, head sha, or PR number");
  }

  const octokit = getInstallationClient(Number(installationId));
  const accountLogin = String(payload.installation?.account?.login || owner);
  const isPrivate = Boolean(payload.repository?.private);

  // Persist installation, repository and scan run. Best effort: a database problem
  // must not stop the PR from getting a check.
  let installationRowId: string | undefined;
  let scanRunId: string | undefined;
  if (db) {
    try {
      const accountType = String(payload.installation?.account?.type || "Unknown");
      const installation = (await db.insert(installations).values({
        githubInstallationId: Number(installationId),
        accountLogin,
        accountType,
      }).onConflictDoUpdate({
        target: installations.githubInstallationId,
        set: { accountLogin, accountType, updatedAt: new Date() },
      }).returning({ id: installations.id }))[0];
      installationRowId = installation.id;
      const fullName = String(payload.repository.full_name || `${owner}/${repo}`);
      const defaultBranch = String(payload.repository.default_branch || "main");
      const repository = (await db.insert(repositories).values({
        installationId: installation.id,
        githubRepositoryId: Number(payload.repository.id),
        fullName,
        defaultBranch,
      }).onConflictDoUpdate({
        target: repositories.githubRepositoryId,
        set: { installationId: installation.id, fullName, defaultBranch, updatedAt: new Date() },
      }).returning({ id: repositories.id }))[0];
      const run = (await db.insert(scanRuns).values({
        repositoryId: repository.id,
        githubDeliveryId: deliveryId || undefined,
        pullRequestNumber: prNumber,
        commitSha: headSha,
        status: "running",
        startedAt: new Date(),
      }).returning({ id: scanRuns.id }))[0];
      scanRunId = run.id;
    } catch (error) {
      console.error(JSON.stringify({ event: "pr_scan_persist_failed", deliveryId, error: error instanceof Error ? error.message : "unknown" }));
    }
  }

  // Private repositories need Pro. If billing can't be verified, don't scan privately for free.
  if (isPrivate) {
    let pro = false;
    try { pro = await isProActive(owner); }
    catch (error) { console.error(`Could not verify Pro for ${owner}:`, error); }
    if (!pro) {
      await octokit.checks.create({
        owner, repo, name: CHECK_NAME, head_sha: headSha,
        status: "completed", conclusion: "neutral",
        output: {
          title: "Upgrade to scan private repositories",
          summary: "Warden CI scans public repositories for free. Private repositories need an active Pro plan. Upgrade and the scan will run on the next push.",
        },
      });
      return;
    }
  }

  const checkRun = await octokit.checks.create({
    owner, repo, name: CHECK_NAME, head_sha: headSha, status: "in_progress",
    output: { title: "Warden CI is scanning this pull request", summary: "Fetching changed files and evaluating policy." },
  });

  try {
    // Effective policy. Block mode is a paid capability: downgrade to report unless Pro is verified.
    let policy: EnforcementPolicy | undefined;
    if (installationRowId) {
      try {
        let loaded = await deps.loadPolicy(installationRowId);
        if (loaded.mode === "block") {
          let pro = false;
          try { pro = await isProActive(accountLogin); } catch { pro = false; }
          if (!pro) loaded = { ...loaded, mode: "report" };
        }
        policy = loaded;
      } catch (error) {
        console.error(JSON.stringify({ event: "pr_scan_policy_load_failed", deliveryId, error: error instanceof Error ? error.message : "unknown" }));
      }
    }

    const files = await octokit.paginate(octokit.pulls.listFiles, { owner, repo, pull_number: prNumber, per_page: 100 });
    const result: any = await scanFiles(files.map((f) => ({ filename: f.filename, patch: f.patch })), policy);
    const annotations: ScanAnnotation[] = result.annotations;
    const filesScanned: number = result.filesScanned;
    const filesSkipped: number = result.filesSkipped;
    const incomplete = result.verdict === "incomplete";
    const blocked = Boolean(result.policyDecision?.shouldBlock);
    const verdict = blocked ? "failure" : incomplete ? "incomplete" : "success";

    if (db && scanRunId) {
      try {
        if (annotations.length > 0) {
          await db.insert(findings).values(annotations.map((annotation: any, index: number) => ({
            scanRunId: scanRunId as string,
            fingerprint: annotation.fingerprint || `${annotation.path}:${annotation.line}:${annotation.title}:${index}`,
            severity: annotation.severity,
            category: annotation.category,
            title: annotation.title,
            message: annotation.message,
            remediation: annotation.remediation,
            packageName: annotation.packageName,
            ecosystem: annotation.ecosystem,
            manifestPath: annotation.manifestPath,
            filePath: annotation.path,
            lineNumber: annotation.line,
          }))).onConflictDoNothing();
        }
        await db.update(scanRuns).set({
          status: "completed", verdict, findingsCount: annotations.length, completedAt: new Date(),
        }).where(eq(scanRuns.id, scanRunId));
      } catch (error) {
        console.error(JSON.stringify({ event: "pr_scan_save_failed", deliveryId, error: error instanceof Error ? error.message : "unknown" }));
      }
    }

    const conclusion: "failure" | "neutral" | "success" =
      blocked || incomplete ? "failure" : annotations.length > 0 ? "neutral" : "success";
    const reportLink = scanRunId ? `\n\n[View security report](${CANONICAL_BASE_URL}/details?runId=${encodeURIComponent(scanRunId)})` : "";

    await octokit.checks.update({
      owner, repo, check_run_id: checkRun.data.id,
      status: "completed", conclusion,
      output: {
        title: annotations.length === 0 ? "No issues found" : `${annotations.length} finding(s)`,
        summary: summarize(annotations, filesScanned, filesSkipped) + reportLink,
        annotations: annotations.slice(0, MAX_ANNOTATIONS).map((a: any) => ({
          path: a.path,
          start_line: a.line,
          end_line: a.line,
          annotation_level: ["failure", "high", "critical"].includes(String(a.severity)) ? "failure" as const : "warning" as const,
          title: a.title,
          message: `${a.message} Remediation: ${a.remediation}`,
        })),
      },
    });

    // Corpus telemetry: public repos by default, private only with opt-in. Package fields only.
    try {
      if (await corpusLoggingAllowed(Number(installationId), isPrivate)) {
        const timestamp = new Date().toISOString();
        await Promise.all((result.packageFlags ?? []).map((flag: any) => logCorpusEvent({
          ecosystem: flag.ecosystem, packageName: flag.packageName, verdict: flag.verdict,
          impersonating: flag.impersonating, timestamp,
        })));
      }
    } catch (error) {
      console.error(JSON.stringify({ event: "pr_scan_telemetry_failed", deliveryId, error: error instanceof Error ? error.message : "unknown" }));
    }
  } catch (error) {
    if (db && scanRunId) {
      await db.update(scanRuns).set({ status: "failed", completedAt: new Date() }).where(eq(scanRuns.id, scanRunId)).catch(() => {});
    }
    await octokit.checks.update({
      owner, repo, check_run_id: checkRun.data.id, status: "completed", conclusion: "neutral",
      output: { title: "Warden CI could not finish this scan", summary: "An internal error stopped the scan. Pushing a new commit will retry it." },
    }).catch(() => {});
    throw error;
  }
}