# Warden Agent Guard — Claude Code hook (prototype)

Blocks Claude Code from running `npm install`, `pip install`, `cargo add`, `go get`,
etc. on a package that Warden's existing detection flags as hallucinated,
typosquatted, or a confirmed known-malware advisory — **before** the install runs,
not after it's already in your lockfile.

This reuses the exact API the Warden VS Code extension already calls
(`GET /api/check/package`). No new backend was needed to build this prototype.

## What it does

1. Claude Code is about to run a `Bash` tool call.
2. This hook receives that command on stdin *before* it executes.
3. If the command looks like a package install, it pulls out the package name(s)
   and ecosystem, and asks Warden's server whether each one is safe.
4. If Warden returns a high-severity flag (hallucinated / known-malware /
   dependency-confusion), the hook exits with code `2`, which blocks the command
   and shows Claude the reason, so it can reconsider instead of installing.
5. Lower-severity flags (e.g. "recently published, different publisher") are shown
   as a warning but do not block.
6. Anything Warden can't reach in time, or doesn't recognize as an install command,
   is allowed through untouched — this fails open by design, same as the rest of
   the Warden codebase.

## What it does NOT do yet (be aware of this before showing it to testers)

- **No audit trail.** Nothing is logged anywhere right now — a blocked attempt just
  prints to stderr and disappears. The team/audit-log version (the actual
  monetizable layer, per our discussion) needs a new backend endpoint, e.g.
  `POST /api/telemetry/agent-block`, to record: timestamp, repo, package, verdict,
  and whether the agent proceeded anyway. That does not exist yet — this prototype
  is deliberately scoped to "does the blocking mechanism work at all."
- **No RubyGems support** — Warden's `/api/check/package` endpoint currently only
  accepts `npm`, `pypi`, `cargo`, `go` (matches the existing IDE extension's limits).
- **Command parsing is best-effort, not a full shell parser.** It handles simple
  `&&` / `;` / `|` chaining and the common install verbs, but will miss unusual
  quoting, heredocs, or install commands wrapped in a script/Makefile target.
- **Only covers `Bash` tool calls.** If an agent uses a different mechanism to
  write dependency files directly (e.g. editing `package.json` and letting a
  separate process install later), this hook never sees it.

## Setup (for a tester)

1. Save `warden-guard.mjs` somewhere on your machine, e.g. `~/.claude/warden-guard.mjs`.
2. In your Claude Code settings (project `.claude/settings.json` or user-level
   `~/.claude/settings.json`), add:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "node ~/.claude/warden-guard.mjs"
          }
        ]
      }
    ]
  }
}
```

3. Restart Claude Code (or start a new session) so it picks up the hook.
4. Optional env vars:
   - `WARDEN_URL` — override the Warden server (defaults to the production one).
   - `WARDEN_HOOK_TIMEOUT_MS` — per-package check timeout, default `4000`.
   - `WARDEN_HOOK_DEBUG=1` — print what the hook is checking, to stderr.

## Quick manual test

Ask Claude Code (with the hook installed) to run something like:

```
npm install this-package-definitely-does-not-exist-abcxyz123
```

You should see the command get blocked with a Warden message instead of npm
printing a 404. That confirms the wiring works end to end.
