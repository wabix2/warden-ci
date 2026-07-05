/**
 * Warden CI \u2014 heuristic detection layer.
 *
 * This runs first on every changed file. It's cheap (no network calls) and produces
 * a 0-100 score plus a list of findings. Files that land in the "uncertain" band
 * (see scoring.ts) get escalated to the LLM classifier for a second opinion.
 *
 * This is intentionally rule-based and inspectable: every finding has a human-readable
 * reason, because "trust our black box" is not a sellable product in Year 1.
 */

import { parse } from "@babel/parser";
import traverse from "@babel/traverse";
import { ChangedFile, HeuristicFinding, HeuristicResult } from "./types";

const JS_TS_EXTENSIONS = [".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"];
const MAX_PATCH_SIZE = 200_000; // characters; larger diffs are skipped for cost/perf reasons

const GENERIC_IDENTIFIERS = new Set([
  "data", "result", "results", "item", "items", "temp", "tmp", "val", "value",
  "res", "obj", "foo", "bar", "baz", "output", "input", "response", "resp",
]);

// Phrases that sometimes leak into generated code from chat-style completions.
const LEAKED_PHRASES: RegExp[] = [
  /as an ai( language model)?/i,
  /i cannot (assist|help|provide)/i,
  /here('|\u2019)?s (an? )?(updated|revised|corrected) (version|code|function)/i,
  /```(javascript|python|typescript|json)?\s*$/m, // stray markdown fences left in source
  /\bTODO:?\s*implement\b/i,
  /\bplaceholder\b.*\b(function|logic|implementation)\b/i,
  /your[_-]?api[_-]?key[_-]?here/i,
  // Looks like a real OpenAI-style API key pasted into code. Requires 32+ chars after the
  // prefix and a word boundary on both ends \u2014 shorter thresholds were matching arbitrary
  // base58/hex strings in crypto/blockchain code as false positives.
  /\bsk-(proj-)?[a-zA-Z0-9]{32,}\b/,
];

// Comments that restate the obvious, e.g. "// increment i by 1" above "i++"
const OBVIOUS_COMMENT_PATTERNS: RegExp[] = [
  /\/\/\s*(increment|decrement)\s+\w+\s+by\s+1/i,
  /\/\/\s*(loop|iterate)\s+(through|over)\s+(the\s+)?\w+/i,
  /\/\/\s*(return|returns)\s+the\s+result/i,
  /\/\/\s*(initialize|initializes|create[s]?)\s+(a|an|the)\s+\w+\s+variable/i,
  /\/\/\s*this function\s+(does|performs|handles)/i,
];

function detectLanguageFamily(filename: string): "js-ts" | "other" {
  const ext = filename.slice(filename.lastIndexOf("."));
  return JS_TS_EXTENSIONS.includes(ext) ? "js-ts" : "other";
}

/** Extract only the added lines (lines starting with "+") from a unified diff patch. */
function addedLines(patch: string): { text: string; lineNo: number }[] {
  const lines = patch.split("\n");
  const out: { text: string; lineNo: number }[] = [];
  let newLineNo = 0;

  for (const line of lines) {
    const hunkHeader = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunkHeader) {
      newLineNo = parseInt(hunkHeader[1], 10) - 1;
      continue;
    }
    if (line.startsWith("+") && !line.startsWith("+++")) {
      newLineNo += 1;
      out.push({ text: line.slice(1), lineNo: newLineNo });
    } else if (!line.startsWith("-") && !line.startsWith("---")) {
      newLineNo += 1;
    }
  }
  return out;
}

function runPatternChecks(added: { text: string; lineNo: number }[]): HeuristicFinding[] {
  const findings: HeuristicFinding[] = [];
  const fullText = added.map((a) => a.text).join("\n");

  for (const phrase of LEAKED_PHRASES) {
    const match = fullText.match(phrase);
    if (match) {
      const lineIdx = added.findIndex((a) => phrase.test(a.text));
      findings.push({
        rule: "leaked-generation-artifact",
        description: `Line contains a phrase commonly left behind by copy-pasted LLM output ("${match[0].slice(0, 60)}").`,
        line: lineIdx >= 0 ? added[lineIdx].lineNo : undefined,
        weight: 22,
      });
    }
  }

  let obviousCommentCount = 0;
  for (const line of added) {
    for (const pattern of OBVIOUS_COMMENT_PATTERNS) {
      if (pattern.test(line.text)) {
        obviousCommentCount += 1;
        findings.push({
          rule: "obvious-comment",
          description: "Comment restates what the next line of code already makes obvious \u2014 a common LLM tic.",
          line: line.lineNo,
          weight: 6,
        });
        break;
      }
    }
  }

  // Generic identifier density (regex word-boundary count over added lines only)
  let genericHits = 0;
  let identifierLikeTokens = 0;
  for (const line of added) {
    const tokens = line.text.match(/\b[a-zA-Z_][a-zA-Z0-9_]*\b/g) || [];
    for (const tok of tokens) {
      identifierLikeTokens += 1;
      if (GENERIC_IDENTIFIERS.has(tok.toLowerCase())) genericHits += 1;
    }
  }
  if (identifierLikeTokens > 20) {
    const density = genericHits / identifierLikeTokens;
    if (density > 0.08) {
      findings.push({
        rule: "generic-identifier-density",
        description: `${(density * 100).toFixed(0)}% of identifiers in this change are generic names (data, result, item, etc.) \u2014 higher than typical hand-written code in most style guides.`,
        weight: Math.min(15, Math.round(density * 100)),
      });
    }
  }

  return findings;
}

/** JS/TS-specific structural checks using a lightweight AST pass. */
function runAstChecks(filename: string, fullSourceGuess: string): HeuristicFinding[] {
  const findings: HeuristicFinding[] = [];
  try {
    const ast = parse(fullSourceGuess, {
      sourceType: "unambiguous",
      plugins: ["typescript", "jsx"],
      errorRecovery: true,
    });

    let functionCount = 0;
    let genericCatchCount = 0;
    const bodyHashes = new Map<string, number>();

    traverse(ast, {
      "FunctionDeclaration|FunctionExpression|ArrowFunctionExpression"(path: any) {
        functionCount += 1;
        // crude structural fingerprint: count of statement types in the body,
        // used to flag near-duplicate function bodies (a common sign of
        // generate-per-endpoint LLM scaffolding rather than shared abstractions).
        const bodyNode = path.node.body;
        if (bodyNode && bodyNode.body) {
          const shape = bodyNode.body.map((s: any) => s.type).join(",");
          bodyHashes.set(shape, (bodyHashes.get(shape) || 0) + 1);
        }
      },
      CatchClause(path: any) {
        const body = path.node.body?.body || [];
        const isGeneric =
          body.length <= 1 &&
          (body.length === 0 ||
            (body[0].type === "ExpressionStatement" &&
              JSON.stringify(body[0]).toLowerCase().includes("console")));
        if (isGeneric) genericCatchCount += 1;
      },
    });

    if (functionCount >= 4) {
      const maxDuplicateShape = Math.max(0, ...Array.from(bodyHashes.values()));
      if (maxDuplicateShape >= 4) {
        findings.push({
          rule: "duplicate-function-structure",
          description: `${maxDuplicateShape} functions in this file share an identical statement structure \u2014 consistent with template-per-endpoint generation rather than a shared abstraction a human would typically factor out.`,
          weight: 12,
        });
      }
    }

    if (genericCatchCount >= 3) {
      findings.push({
        rule: "generic-error-handling",
        description: `${genericCatchCount} catch blocks do nothing but log \u2014 a common pattern in generated boilerplate that hasn't been adapted to real error handling.`,
        weight: 8,
      });
    }
  } catch {
    // Parse failures are expected for partial diffs reconstructed without full file context.
    // We don't penalize the file for this \u2014 it just means we skip the AST pass.
  }
  return findings;
}

/**
 * Scores a single changed file. `patch` is the unified diff as returned by GitHub;
 * we don't require the full file content, which keeps this fast and avoids extra API calls.
 */
export function scoreFile(file: ChangedFile): HeuristicResult {
  if (!file.patch || file.patch.length === 0) {
    return { filename: file.filename, score: 0, findings: [], skipped: "no diff content (binary or too large)" };
  }
  if (file.patch.length > MAX_PATCH_SIZE) {
    return { filename: file.filename, score: 0, findings: [], skipped: "diff exceeds size limit for scanning" };
  }

  const added = addedLines(file.patch);
  if (added.length === 0) {
    return { filename: file.filename, score: 0, findings: [] };
  }

  let findings = runPatternChecks(added);

  if (detectLanguageFamily(file.filename) === "js-ts") {
    // Best-effort reconstruction: parsing just the added lines catches real structural
    // signal often enough to be useful, even though it isn't the full file.
    const guessedSource = added.map((a) => a.text).join("\n");
    findings = findings.concat(runAstChecks(file.filename, guessedSource));
  }

  const rawScore = findings.reduce((sum, f) => sum + f.weight, 0);
  const score = Math.max(0, Math.min(100, rawScore));

  return { filename: file.filename, score, findings };
}

export function scoreFiles(files: ChangedFile[]): HeuristicResult[] {
  return files.map(scoreFile);
}
