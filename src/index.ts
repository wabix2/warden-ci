/**
 * Warden CI \u2014 GitHub App entrypoint.
 *
 * Listens for pull_request open/sync events, pulls the changed files + diffs from
 * GitHub's API, runs them through the Warden scoring pipeline, and reports the
 * result as a Check Run that shows up directly in the PR's checks tab \u2014
 * zero new habit required from the developer, per the Year 1 distribution thesis.
 */

import { Probot, ApplicationFunctionOptions } from "probot";
import { ChangedFile, ScanSummary, FileVerdict } from "./types";
import { runScan } from "./scoring";

const CHECK_NAME = "Warden CI";

function bandEmoji(band: "low" | "medium" | "high"): string {
  return band === "high" ? "\ud83d\udd34" : band === "medium" ? "\ud83d\udfe1" : "\ud83d\udfe2";
}

function summaryMarkdown(summary: ScanSummary): string {
  const lines: string[] = [];
  lines.push(`**Overall risk score: ${summary.overallScore}/100**`);
  lines.push("");
  lines.push(`Scanned ${summary.filesScanned} file(s), skipped ${summary.filesSkipped}.`);
  lines.push("");

  const flagged = summary.fileVerdicts.filter((v) => v.band !== "low");
  if (flagged.length > 0) {
    lines.push("### Flagged files");
    for (const v of flagged) {
      lines.push(`${bandEmoji(v.band)} **${v.filename}** \u2014 score ${v.finalScore}/100`);
      for (const f of v.findings) {
        lines.push(`  - _${f.rule}_: ${f.description}`);
      }
      if (v.llmRationale) {
        lines.push(`  - _model review_: ${v.llmRationale}`);
      }
    }
    lines.push("");
  } else {
    lines.push("No files scored above the low-risk threshold. \ud83d\udfe2");
    lines.push("");
  }

  if (summary.dependencyFindings.length > 0) {
    lines.push("### Dependency findings");
    for (const d of summary.dependencyFindings) {
      const icon = d.riskLevel === "high" ? "\ud83d\udd34" : "\ud83d\udfe1";
      lines.push(`${icon} **${d.name}** (${d.ecosystem}) \u2014 ${d.riskLevel} risk`);
      for (const r of d.reasons) lines.push(`  - ${r}`);
    }
    lines.push("");
  }

  lines.push(
    "_Warden CI flags patterns associated with AI-generated, unverifiable, or tampered code. " +
      "It does not block merges by default \u2014 review flagged items and use your judgment._"
  );
  return lines.join("\n");
}

function conclusionFor(summary: ScanSummary): "success" | "neutral" | "action_required" {
  const anyHigh = summary.fileVerdicts.some((v) => v.band === "high") ||
    summary.dependencyFindings.some((d) => d.riskLevel === "high");
  if (anyHigh) return "action_required";
  const anyMedium = summary.fileVerdicts.some((v) => v.band === "medium");
  if (anyMedium) return "neutral";
  return "success";
}

function toAnnotations(fileVerdicts: FileVerdict[]) {
  // GitHub caps annotations at 50 per check run update.
  const annotations: any[] = [];
  for (const v of fileVerdicts) {
    if (v.band === "low") continue;
    for (const finding of v.findings) {
      if (annotations.length >= 50) break;
      annotations.push({
        path: v.filename,
        start_line: finding.line || 1,
        end_line: finding.line || 1,
        annotation_level: v.band === "high" ? "failure" : "warning",
        message: finding.description,
        title: finding.rule,
      });
    }
  }
  return annotations;
}

export default (app: Probot, { getRouter }: ApplicationFunctionOptions) => {
  // Free-tier hosts (Render, Fly, Railway) use this to confirm the process is alive
  // before routing traffic to it, and to wake sleeping instances.
  if (getRouter) {
    const router = getRouter("/");
    router.get("/healthz", (_req, res) => {
      res.status(200).json({ status: "ok", app: CHECK_NAME });
    });
  }

  app.on(["pull_request.opened", "pull_request.synchronize", "pull_request.reopened"], async (context) => {
    const { owner, repo } = context.repo();
    const pr = context.payload.pull_request;

    const checkRun = await context.octokit.checks.create({
      owner,
      repo,
      name: CHECK_NAME,
      head_sha: pr.head.sha,
      status: "in_progress",
      started_at: new Date().toISOString(),
    });

    try {
      // GitHub's PR files endpoint caps at 3000 files across pages; paginate rather
      // than hard-coding a single page of 100, or large PRs get silently truncated.
      const files = await context.octokit.paginate(context.octokit.pulls.listFiles, {
        owner,
        repo,
        pull_number: pr.number,
        per_page: 100,
      });

      const changedFiles: ChangedFile[] = files.map((f) => ({
        filename: f.filename,
        status: f.status as ChangedFile["status"],
        patch: f.patch,
        additions: f.additions,
        deletions: f.deletions,
      }));

      const summary = await runScan(changedFiles);
      const conclusion = conclusionFor(summary);
      const annotations = toAnnotations(summary.fileVerdicts);

      await context.octokit.checks.update({
        owner,
        repo,
        check_run_id: checkRun.data.id,
        status: "completed",
        conclusion,
        completed_at: new Date().toISOString(),
        output: {
          title: `Risk score: ${summary.overallScore}/100`,
          summary: summaryMarkdown(summary),
          annotations,
        },
      });
    } catch (err) {
      app.log.error(err);
      await context.octokit.checks.update({
        owner,
        repo,
        check_run_id: checkRun.data.id,
        status: "completed",
        conclusion: "neutral",
        completed_at: new Date().toISOString(),
        output: {
          title: "Warden CI scan failed",
          summary: `An error occurred while scanning this PR: ${(err as Error).message}. This is not a verdict on the code \u2014 please re-run or check the app logs.`,
        },
      });
    }
  });
};
