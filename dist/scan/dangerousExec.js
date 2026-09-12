"use strict";
/**
 * Warden CI — dangerous dynamic execution detection.
 *
 * Flags patterns that run attacker-influenceable strings as code or shell
 * commands: eval(), new Function(), and unguarded child_process exec calls.
 * These are worth flagging regardless of whether the code is AI-written —
 * they're risky in any PR — which is part of why this check ages better
 * than an "AI-generated" label would.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkDangerousExec = checkDangerousExec;
const PATTERNS = [
    { name: "eval()", regex: /\beval\s*\(/ },
    { name: "new Function()", regex: /\bnew\s+Function\s*\(/ },
    { name: "child_process.exec()", regex: /\b(child_process\.)?\bexec(Sync)?\s*\(/ },
    { name: "shell:true in spawn/exec", regex: /\bshell\s*:\s*true\b/ },
    { name: "child_process.execFile() with shell", regex: /\bexecFile(?:Sync)?\s*\([^\n]*\bshell\s*:\s*true\b/ },
    { name: "Python subprocess shell", regex: /\bsubprocess\.(?:run|Popen|call|check_output)\s*\([^\n]*shell\s*=\s*True\b/ },
    { name: "Python eval/exec", regex: /\b(?:eval|exec)\s*\(/ },
    { name: "GitHub Actions untrusted checkout", regex: /pull_request_target[\s\S]{0,500}checkout@v[34]/ },
    { name: "GitHub Actions script injection", regex: /run:\s*[^\n]*(?:github\.event|github\.head_ref|github\.title)/ },
    { name: "Terraform broad IAM action", regex: /actions\s*=\s*\[?\s*["']\*["']/ },
];
const SKIP_IF_CONTAINS = ["// eslint-disable", "test", "spec.ts", "spec.js"];
function checkDangerousExec(addedLines) {
    const findings = [];
    for (const { line, content } of addedLines) {
        const trimmed = content.trim();
        if (trimmed.startsWith("//") || trimmed.startsWith("*"))
            continue; // comments
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
