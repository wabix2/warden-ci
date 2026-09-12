/**
 * Warden CI — pull_request webhook handler.
 *
 * Flow per event:
 *  1. Verify the GitHub signature on the raw body.
 *  2. Only act on pull_request opened/synchronize/reopened — those are the
 *     events where the diff has actually changed.
 *  3. Authenticate as the installation that sent the event.
 *  4. List the PR's changed files (which include per-file unified diffs).
 *  5. Run the three checks over added lines only — we only ever flag new
 *     code introduced by this PR, never pre-existing code the PR didn't touch.
 *  6. Post a single Check Run with the results.
 *
 * This handler responds 200 quickly and does the work inline for now. If
 * scan volume grows, the honest next step is a queue (webhook handler enqueues,
 * a worker processes) so GitHub's webhook delivery timeout can't be an issue —
 * called out here rather than silently deferred.
 */

import { Request, Response } from "express";
import { eq } from "drizzle-orm";
import { getInstallationClient } from "./appAuth";
import { verifyGithubSignature } from "./verifySignature";
import { scanFiles, ScanAnnotation } from "../scan";
import { logCorpusEvent, telemetryEnabled } from "../telemetry/corpusLog";
import { isProActive } from "../billing/store";
import { getRedisClient } from "../lib/redis";
import { evaluateGate } from "../enforcement/policy";
import { db } from "../db";
import { scanRuns, findings } from "../db/schema";

const ACTIONABLE_ACTIONS = new Set(["opened", "synchronize", "reopened"]);

function summaryFor(annotations: ScanAnnotation[], filesScanned: number, filesSkipped: number): string {
  if (annotations.length === 0) {
    return `Scanned ${filesScanned} changed file(s). No unverified packages, hardcoded secrets, or dangerous dynamic execution found in the added code.` +
      (filesSkipped > 0 ? `\n\n_${filesSkipped} file(s) were skipped (binary or too large for GitHub to provide a diff).` : "");
  }
  const secretCount = annotations.filter((a) => a.title === "Possible hardcoded secret").length;
  const pkgCount = annotations.filter((a) => a.title === "Unverified package").length;
  const typosquatCount = annotations.filter((a) => a.title === "Possible typosquat package").length;
  const confusionCount = annotations.filter((a) => a.title === "Possible dependency-confusion package").length;
  const takeoverCount = annotations.filter((a) => a.title === "Possible maintainer takeover").length;
  const execCount = annotations.filter((a) => a.title === "Dangerous dynamic execution").length;
  const parts: string[] = [];
  if (secretCount) parts.push(`${secretCount} possible hardcoded secret(s)`);
  if (typosquatCount) parts.push(`${typosquatCount} possible typosquat package(s)`);
  if (confusionCount) parts.push(`${confusionCount} possible dependency-confusion package(s)`);
  if (takeoverCount) parts.push(`${takeoverCount} possible maintainer takeover(s)`);
  if (pkgCount) parts.push(`${pkgCount} unverified package import(s)`);
  if (execCount) parts.push(`${execCount} dangerous dynamic execution pattern(s)`);
  return `Found ${parts.join(", ")} across ${filesScanned} scanned file(s).`;
}

export async function handlePullRequestWebhook(req: Request, res: Response): Promise<void> {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) {
    console.error("GITHUB_WEBHOOK_SECRET is not configured");
    res.status(500).send("Webhook secret not configured");
    return;
  }

  const signature = req.headers["x-hub-signature-256"] as string | undefined;
  // This route is mounted with express.raw({ type: "application/json" }) — same
  // pattern as the existing /billing/webhook route — so req.body is the raw Buffer,
  // not parsed JSON. We verify the signature against those exact bytes, then parse.
  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(String(req.body ?? ""));

  if (rawBody.length === 0 || !verifyGithubSignature(rawBody, signature, secret)) {
    res.status(401).send("Invalid signature");
    return;
  }

  const event = req.headers["x-github-event"];
  if (event !== "pull_request") {
    res.status(204).send();
    return;
  }

  let payload: any;
  try {
    payload = JSON.parse(rawBody.toString("utf8"));
  } catch (err) {
    console.error("Failed to parse webhook payload as JSON:", err);
    res.status(400).send("Invalid payload");
    return;
  }
  const action = payload?.action;
  if (!ACTIONABLE_ACTIONS.has(action)) {
    res.status(204).send();
    return;
  }

  // Respond to GitHub immediately; do the scan work after. GitHub expects a
  // fast response and will retry deliveries that time out, which would cause
  // duplicate Check Runs otherwise.
  res.status(202).send("Accepted");

  try {
    const deliveryId = String(req.headers["x-github-delivery"] || "").trim();
    if (deliveryId) {
      const claimed = await getRedisClient().set(`warden:delivery:${deliveryId}`, "1", { nx: true, ex: 86400 });
      if (claimed !== "OK") return;
    }

    const installationId = payload.installation?.id;
    const owner = payload.repository?.owner?.login;
    const repo = payload.repository?.name;
    const headSha = payload.pull_request?.head?.sha;
    const prNumber = payload.pull_request?.number;

    if (!installationId || !owner || !repo || !headSha || !prNumber) {
      console.error("Webhook payload missing required fields", { installationId, owner, repo, headSha, prNumber });
      return;
    }

    const octokit = getInstallationClient(installationId);
    const scanRun = db ? (await db.insert(scanRuns).values({
      repositoryId: String(payload.repository?.id || installationId) as never,
      githubDeliveryId: deliveryId || undefined,
      pullRequestNumber: prNumber,
      commitSha: headSha,
      status: "running",
      startedAt: new Date(),
    }).returning({ id: scanRuns.id }))[0] : undefined;

    // Private-repo scanning is a Pro feature. Public repos always scan free —
    // that's the distribution engine (see README "Pricing"). This is the first
    // place billing status actually gates anything; previously Pro/Team/Enterprise
    // were sold but nothing checked them before scanning.
    const isPrivate = Boolean(payload.repository?.private);
    let proActive = true;
    if (isPrivate) {
      try {
        proActive = await isProActive(owner);
      } catch (err) {
        // If the billing store is unreachable, fail CLOSED for private repos —
        // the safer default is "don't scan" over "scan for free," since the
        // opposite failure mode silently gives away the paid tier.
        console.error(`Could not check Pro status for ${owner}, failing closed:`, err);
        proActive = false;
      }
    }

    if (isPrivate && !proActive) {
      await octokit.checks.create({
        owner,
        repo,
        name: "Warden CI",
        head_sha: headSha,
        status: "completed",
        conclusion: "neutral",
        output: {
          title: "Upgrade to scan private repositories",
          summary:
            "Warden CI scans public repositories for free. This is a private repository, " +
            "which requires an active Pro (or higher) plan. Visit /subscribe on your Warden CI " +
            "deployment to upgrade — the scan will run automatically on the next push once billing is active.",
        },
      });
      return;
    }

    const checkRun = await octokit.checks.create({
      owner,
      repo,
      name: "Warden CI",
      head_sha: headSha,
      status: "in_progress",
      output: { title: "Warden is scanning this pull request", summary: "Fetching changed files and evaluating policy." },
    });

    const files = await octokit.paginate(octokit.pulls.listFiles, {
      owner,
      repo,
      pull_number: prNumber,
      per_page: 100,
    });

    const scanResult = await scanFiles(files.map((f) => ({ filename: f.filename, patch: f.patch })));
    const { annotations, packageFlags, filesScanned, filesSkipped } = scanResult;
    const gate = evaluateGate(annotations);
    const incomplete = scanResult.verdict === "incomplete";
    if (incomplete) {
      console.warn(`Warden scan ${deliveryId || "unknown"} is incomplete: ${filesSkipped} file(s) had no patch`);
    }

    if (db && scanRun) {
      await db.insert(findings).values(annotations.map((annotation, index) => ({
        scanRunId: scanRun.id,
        fingerprint: annotation.fingerprint || `${annotation.path}:${annotation.line}:${annotation.title}:${index}`,
        severity: annotation.severity,
        category: annotation.category,
        title: annotation.title,
        message: annotation.message,
        remediation: annotation.remediation,
        filePath: annotation.path,
        lineNumber: annotation.line,
      })));
      await db.update(scanRuns).set({
        status: "completed",
        verdict: gate.shouldBlock ? "failure" : incomplete ? "incomplete" : "success",
        findingsCount: annotations.length,
        completedAt: new Date(),
      }).where(eq(scanRuns.id, scanRun.id));
    }

    await octokit.checks.update({
      owner,
      repo,
      check_run_id: checkRun.data.id,
      status: "completed",
      conclusion: gate.shouldBlock || incomplete ? "failure" : annotations.length > 0 ? "neutral" : "success",
      output: {
        title: annotations.length === 0 ? "No issues found" : `${annotations.length} finding(s)`,
        summary: summaryFor(annotations, filesScanned, filesSkipped),
        annotations: annotations.map((a) => ({
          path: a.path,
          start_line: a.line,
          end_line: a.line,
          annotation_level: a.severity === "failure" ? "failure" : "warning",
          title: a.title,
          message: `${a.message} Remediation: ${a.remediation}`,
        })),
      },
    });

    if (telemetryEnabled()) {
      const timestamp = new Date().toISOString();
      await Promise.all(
        packageFlags.map((flag) =>
          logCorpusEvent({
            ecosystem: flag.ecosystem,
            packageName: flag.packageName,
            verdict: flag.verdict,
            impersonating: flag.impersonating,
            installationId,
            timestamp,
          })
        )
      );
    }
  } catch (err) {
    console.error("Warden CI scan failed:", err);
  }
}
