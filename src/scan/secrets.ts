/**
 * Warden CI — hardcoded secret detection.
 *
 * Deliberately narrow and pattern-specific rather than a broad entropy
 * scanner. High-entropy-string detectors flag things like hashes, UUIDs, and
 * base64 test fixtures constantly, and a checker that cries wolf gets muted
 * and forgotten. Every pattern here matches a specific, recognizable secret
 * format from a real provider, or a clearly-labeled assignment — trading
 * recall for precision on purpose.
 */

import { AddedLine } from "./diff";

export interface Finding {
  line: number;
  message: string;
}

interface SecretPattern {
  name: string;
  regex: RegExp;
}

const PATTERNS: SecretPattern[] = [
  { name: "AWS Access Key ID", regex: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "GitHub personal access token", regex: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { name: "Slack token", regex: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: "Stripe secret key", regex: /\bsk_(live|test)_[A-Za-z0-9]{16,}\b/ },
  { name: "Google API key", regex: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: "OpenAI API key", regex: /\bsk-(?:proj|admin|live)-[A-Za-z0-9_-]{20,}\b/ },
  { name: "Anthropic API key", regex: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/ },
  { name: "npm access token", regex: /\bnpm_[A-Za-z0-9]{30,}\b/ },
  { name: "SendGrid API key", regex: /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/ },
  { name: "Private key block", regex: /-----BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/ },
  {
    name: "Hardcoded credential assignment",
    // e.g.  api_key = "sk-abc123...", const password: "hunter2xyz..."
    // Requires a clearly credential-shaped variable name AND a long-ish literal,
    // to avoid flagging things like `token = requestToken()` or `apiKeyLabel = "API Key"`.
    regex: /\b(api[_-]?key|secret|token|password|passwd|access[_-]?key)\b\s*[:=]\s*['"][A-Za-z0-9_\-/+=]{16,}['"]/i,
  },
];

const SKIP_IF_CONTAINS = ["example", "placeholder", "your_", "xxxx", "<", "process.env", "os.environ"];

export function checkSecrets(addedLines: AddedLine[]): Finding[] {
  const findings: Finding[] = [];

  for (const { line, content } of addedLines) {
    const lower = content.toLowerCase();
    if (SKIP_IF_CONTAINS.some((marker) => lower.includes(marker))) continue;

    for (const pattern of PATTERNS) {
      if (pattern.regex.test(content)) {
        findings.push({
          line,
          message: `Possible hardcoded ${pattern.name} in this line. Move secrets to environment variables or a secrets manager instead of committing them.`,
        });
        break; // one finding per line is enough
      }
    }
  }

  return findings;
}
