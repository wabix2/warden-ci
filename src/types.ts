/**
 * Shared types for Warden CI.
 */

export interface ChangedFile {
  filename: string;
  status: "added" | "modified" | "removed" | "renamed" | "copied" | "changed" | "unchanged";
  patch?: string; // unified diff for this file, as returned by GitHub's compare/PR files API
  additions: number;
  deletions: number;
}

export interface HeuristicFinding {
  rule: string; // short id of the rule that fired, e.g. "boilerplate-comment"
  description: string; // human-readable explanation
  line?: number; // best-effort line number in the new file version
  weight: number; // contribution to the file's heuristic score (0-100 scale, can be negative)
}

export interface HeuristicResult {
  filename: string;
  score: number; // 0-100, higher = more likely AI-generated / unverifiable
  findings: HeuristicFinding[];
  skipped?: string; // reason the file was skipped (binary, too large, unsupported language)
}

export interface LlmClassification {
  filename: string;
  score: number; // 0-100, higher = more likely AI-generated / unverifiable
  rationale: string;
  usedFallback: boolean; // true if the LLM call failed and we fell back to heuristic-only
}

export interface DependencyFinding {
  ecosystem: "npm" | "pypi";
  name: string;
  version?: string;
  riskLevel: "low" | "medium" | "high";
  reasons: string[];
}

export interface FileVerdict {
  filename: string;
  heuristicScore: number;
  llmScore?: number;
  finalScore: number; // combined 0-100 risk score
  band: "low" | "medium" | "high";
  findings: HeuristicFinding[];
  llmRationale?: string;
}

export interface ScanSummary {
  overallScore: number; // 0-100
  fileVerdicts: FileVerdict[];
  dependencyFindings: DependencyFinding[];
  filesScanned: number;
  filesSkipped: number;
}
