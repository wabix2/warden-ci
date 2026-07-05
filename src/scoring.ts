/**
 * Warden CI \u2014 scoring & escalation policy.
 *
 * The whole cost model of this product depends on this file: heuristics are free,
 * LLM calls cost money. Only files in the "uncertain" band get escalated. Tune the
 * thresholds here as real false-positive/false-negative data comes in \u2014 see the
 * Year 1 KPI note about tracking false-positive rate obsessively.
 */

import { ChangedFile, DependencyFinding, FileVerdict, ScanSummary } from "./types";
import { scoreFiles } from "./heuristics";
import { classifyFiles } from "./llmClassifier";
import { checkDependencies } from "./dependencyCheck";

// Narrower than an earlier version of this file: the wider the band, the more files
// get escalated to the LLM per PR. At 15-70 roughly half of all scored files were being
// escalated; 20-60 cuts that meaningfully while still catching genuinely ambiguous cases.
// Tune based on real Gemini quota usage and false-positive/negative data as it comes in.
const UNCERTAIN_BAND_LOW = 20; // below this, heuristics are confident it's fine \u2014 skip LLM
const UNCERTAIN_BAND_HIGH = 60; // above this, heuristics are confident it's risky \u2014 skip LLM

const LOW_HIGH_CUTOFF = 30;
const MEDIUM_HIGH_CUTOFF = 65;

function bandFor(score: number): "low" | "medium" | "high" {
  if (score < LOW_HIGH_CUTOFF) return "low";
  if (score < MEDIUM_HIGH_CUTOFF) return "medium";
  return "high";
}

export async function runScan(files: ChangedFile[]): Promise<ScanSummary> {
  const heuristicResults = scoreFiles(files);

  const toEscalate = heuristicResults.filter(
    (r) => !r.skipped && r.score >= UNCERTAIN_BAND_LOW && r.score <= UNCERTAIN_BAND_HIGH
  );
  const escalatedFiles = files.filter((f) => toEscalate.some((r) => r.filename === f.filename));
  const llmResults = escalatedFiles.length > 0 ? await classifyFiles(escalatedFiles) : [];

  const fileVerdicts: FileVerdict[] = heuristicResults
    .filter((r) => !r.skipped)
    .map((h) => {
      const llm = llmResults.find((l) => l.filename === h.filename);
      // Weighted blend when we have both signals; heuristic-only otherwise.
      const finalScore = llm ? Math.round(h.score * 0.4 + llm.score * 0.6) : h.score;
      return {
        filename: h.filename,
        heuristicScore: h.score,
        llmScore: llm?.score,
        finalScore,
        band: bandFor(finalScore),
        findings: h.findings,
        llmRationale: llm?.rationale,
      };
    });

  const dependencyFindings: DependencyFinding[] = await checkDependencies(files);

  const overallScore =
    fileVerdicts.length > 0
      ? Math.round(fileVerdicts.reduce((sum, v) => sum + v.finalScore, 0) / fileVerdicts.length)
      : 0;

  return {
    overallScore,
    fileVerdicts,
    dependencyFindings,
    filesScanned: fileVerdicts.length,
    filesSkipped: heuristicResults.filter((r) => r.skipped).length,
  };
}
