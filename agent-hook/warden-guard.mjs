#!/usr/bin/env node
/**
 * warden-guard.mjs
 *
 * A Claude Code `PreToolUse` hook that intercepts Bash commands *before* they run,
 * pulls out any package-install targets, and checks each one against Warden's
 * existing hallucination / typosquat / known-malware detection API
 * (the same endpoint the VS Code extension already uses:
 *  GET /api/check/package?ecosystem=...&name=...).
 *
 * Why this exists: Socket/Snyk/etc. scan a PR or a CI run, after a human already
 * committed something. An autonomous coding agent installs packages directly in a
 * terminal loop, often with nobody watching that specific command. This hook moves
 * the same check Warden already does to the one place none of Warden's current
 * surfaces cover: the moment *before* the agent's shell command actually executes.
 *
 * Design principles (matching the rest of the Warden codebase):
 *  - Fail OPEN. A network error or timeout must never block a legitimate install.
 *    Only an explicit, positive "flagged" verdict blocks anything.
 *  - Only block on the verdicts Warden's own server already treats as high-severity
 *    ("error"). Lower-severity ("warning") verdicts are surfaced to the agent as
 *    context but do not stop execution — the agent can then choose to double-check.
 *  - Best-effort command parsing, not a full shell parser. It is intentionally
 *    conservative: if a command doesn't clearly match a known install pattern for
 *    npm/yarn/pnpm, pip/uv, cargo, or go, it is left alone.
 *
 * Setup: see README.md in this folder.
 */

import { setTimeout as delay } from "node:timers/promises";

const WARDEN_URL = process.env.WARDEN_URL || "https://warden-ci-dvk5.onrender.com";
const TIMEOUT_MS = Number(process.env.WARDEN_HOOK_TIMEOUT_MS || 4000);
const DEBUG = process.env.WARDEN_HOOK_DEBUG === "1";

function log(...args) {
  if (DEBUG) console.error("[warden-guard]", ...args);
}

// ---------------------------------------------------------------------------
// 1. Read the hook payload Claude Code sends on stdin.
// ---------------------------------------------------------------------------

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

// ---------------------------------------------------------------------------
// 2. Best-effort extraction of {ecosystem, name} pairs from a shell command.
//    Handles simple chaining (&&, ;, |) but not full shell semantics.
// ---------------------------------------------------------------------------

const FLAG_RE = /^-/;

function stripVersionSuffix(token) {
  // Scoped npm package: @scope/name[@version]
  const scoped = token.match(/^(@[^/@]+\/[^@]+)(@.+)?$/);
  if (scoped) return scoped[1];
  // Everything else: name[@version] or name[==version] or name[>=version] or name[/version]
  const at = token.indexOf("@", 1); // skip index 0 in case of stray leading '@'
  const cut = [at, token.indexOf("=="), token.indexOf(">="), token.indexOf("<="), token.indexOf("[")]
    .filter((i) => i > 0)
    .sort((a, b) => a - b)[0];
  return cut ? token.slice(0, cut) : token;
}

function isLocalOrUrl(token) {
  return (
    token.startsWith(".") ||
    token.startsWith("/") ||
    token.startsWith("git+") ||
    token.includes("://") ||
    token.startsWith("file:")
  );
}

function extractTargets(segment) {
  const tokens = segment.trim().split(/\s+/);
  const targets = [];

  const npmMatch = tokens[0] === "npm" || tokens[0] === "yarn" || tokens[0] === "pnpm";
  if (npmMatch && ["install", "i", "add"].includes(tokens[1])) {
    for (const t of tokens.slice(2)) {
      if (FLAG_RE.test(t) || isLocalOrUrl(t)) continue;
      targets.push({ ecosystem: "npm", name: stripVersionSuffix(t) });
    }
    return targets;
  }

  const pipMatch =
    tokens[0] === "pip" || tokens[0] === "pip3" || (tokens[0] === "python" && tokens[1] === "-m" && tokens[2] === "pip") || (tokens[0] === "uv" && tokens[1] === "pip");
  const pipInstallIdx = tokens.indexOf("install");
  if (pipMatch && pipInstallIdx !== -1) {
    for (const t of tokens.slice(pipInstallIdx + 1)) {
      if (FLAG_RE.test(t) || isLocalOrUrl(t) || t === "-r") continue;
      targets.push({ ecosystem: "pypi", name: stripVersionSuffix(t).replace(/\[.*\]$/, "") });
    }
    return targets;
  }
  if (tokens[0] === "uv" && tokens[1] === "add") {
    for (const t of tokens.slice(2)) {
      if (FLAG_RE.test(t)) continue;
      targets.push({ ecosystem: "pypi", name: stripVersionSuffix(t) });
    }
    return targets;
  }

  if (tokens[0] === "cargo" && tokens[1] === "add") {
    for (const t of tokens.slice(2)) {
      if (FLAG_RE.test(t)) continue;
      targets.push({ ecosystem: "cargo", name: stripVersionSuffix(t) });
    }
    return targets;
  }

  if (tokens[0] === "go" && (tokens[1] === "get" || tokens[1] === "install")) {
    for (const t of tokens.slice(2)) {
      if (FLAG_RE.test(t)) continue;
      targets.push({ ecosystem: "go", name: stripVersionSuffix(t) });
    }
    return targets;
  }

  return targets;
}

function extractAllTargets(command) {
  // Split on &&, ;, | as a rough approximation of "separate commands".
  const segments = command.split(/&&|;|\|/);
  const all = [];
  for (const seg of segments) all.push(...extractTargets(seg));
  return all;
}

// ---------------------------------------------------------------------------
// 3. Call Warden's existing check endpoint.
// ---------------------------------------------------------------------------

async function checkPackage(ecosystem, name) {
  const url = `${WARDEN_URL.replace(/\/+$/, "")}/api/check/package?ecosystem=${encodeURIComponent(ecosystem)}&name=${encodeURIComponent(name)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return { ok: false };
    return await res.json();
  } catch (err) {
    log(`check failed for ${ecosystem}:${name}:`, err.message);
    return { ok: false }; // fail open
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// 4. Main
// ---------------------------------------------------------------------------

async function main() {
  let payload;
  try {
    payload = JSON.parse(await readStdin());
  } catch {
    process.exit(0); // can't parse -> fail open, allow
  }

  if (payload?.tool_name !== "Bash") process.exit(0);
  const command = payload?.tool_input?.command;
  if (!command || typeof command !== "string") process.exit(0);

  const targets = extractAllTargets(command);
  if (targets.length === 0) process.exit(0); // not an install command we recognize

  log("checking targets:", targets);

  const results = await Promise.all(
    targets.map(async (t) => ({ ...t, result: await checkPackage(t.ecosystem, t.name) }))
  );

  const blocking = results.filter((r) => r.result?.ok && r.result?.flagged && r.result?.severity === "error");
  const warnings = results.filter((r) => r.result?.ok && r.result?.flagged && r.result?.severity !== "error");

  if (blocking.length > 0) {
    const lines = blocking.map(
      (r) => `  - ${r.ecosystem}:${r.name} — ${r.result.verdict}. ${r.result.message ?? ""}`
    );
    // Exit code 2 on a PreToolUse hook blocks the tool call and shows this
    // message back to Claude so it can reconsider instead of installing.
    console.error(
      `Warden blocked this command — one or more packages look hallucinated, typosquatted, or match a known-malware advisory:\n${lines.join("\n")}\n` +
        `If this is a real, intended package, verify the exact name/publisher and re-run manually.`
    );
    process.exit(2);
  }

  if (warnings.length > 0) {
    const lines = warnings.map((r) => `  - ${r.ecosystem}:${r.name} — ${r.result.verdict}. ${r.result.message ?? ""}`);
    // Non-blocking: printed to stderr with exit 0 so Claude sees it as context
    // without the command being stopped.
    console.error(`Warden warning (not blocking):\n${lines.join("\n")}`);
  }

  process.exit(0);
}

main().catch((err) => {
  log("unexpected error, failing open:", err);
  process.exit(0);
});
