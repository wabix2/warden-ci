# Change Log

All notable changes to the Warden Check extension are documented here.

## [0.2.0]

### Added
- **Python support** — parses `import`, `import ... as`, multi-imports, and
  `from ... import`, maps common module names to their PyPI project name, and skips the
  standard library.
- **Backend-driven detection** — package risk is now evaluated server-side through
  `/api/check/package`, sharing the exact hallucination/typosquat/dependency-confusion
  heuristics Warden CI runs on pull requests. No source code leaves the editor.
- **GitHub sign-in** — `Warden: Sign in` authenticates through the browser and stores
  the session in VS Code SecretStorage.
- **Status bar** — shows Free/Pro state and links to plan management.
- **Pro Quick Fixes** — flagged imports offer "review in dashboard" and "copy
  remediation guidance" code actions for Pro accounts.

### Changed
- Verdicts are cached per session to avoid re-querying on every keystroke.
- Network and registry outages fail open (no false "hallucinated" findings).

## [0.1.0]

- Initial MVP: regex-based npm import scanning against the public npm registry with
  hallucinated-package and new-package diagnostics.
