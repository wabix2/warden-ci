/**
 * Warden CI — dangerous dynamic execution detection.
 *
 * Flags patterns that run attacker-influenceable strings as code or shell
 * commands: eval(), new Function(), and unguarded child_process exec calls.
 * These are worth flagging regardless of whether the code is AI-written —
 * they're risky in any PR — which is part of why this check ages better
 * than an "AI-generated" label would.
 */

import { AddedLine } from "./diff";

export interface Finding {
  line: number;
  message: string;
}

interface ExecPattern {
  name: string;
  regex: RegExp;
}

const PATTERNS: ExecPattern[] = [
  { name: "eval()", regex: /\beval\s*\(/ },
  { name: "new Function()", regex: /\bnew\s+Function\s*\(/ },
  { name: "child_process.exec()", regex: /\b(child_process\.)?\bexec(Sync)?\s*\(/ },
  { name: "shell:true in spawn/exec", regex: /\bshell\s*:\s*true\b/ },
];

const SKIP_IF_CONTAINS = ["// eslint-disable", "test", "spec.ts", "spec.js"];

export function checkDangerousExec(addedLines: AddedLine[]): Finding[] {
  const findings: Finding[] = [];

  for (const { line, content } of addedLines) {
    const trimmed = content.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue; // comments

    for (const pattern of PATTERNS) {
      if (pattern.regex.test(content)) {
        findings.push({
          line,
          message: `Use of ${pattern.name} found. If any part of this input can be influenced by user data or an untrusted source, this is a code-injection risk — confirm the input is fully trusted before merging.`,
        });
        break;
      }
    }
  }

  return findings;
}
