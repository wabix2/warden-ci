# Warden Check

Catch risky package imports **before** they land in a commit. Warden Check flags
hallucinated, typosquat, and dependency-confusion package names as you type — the same
detection [Warden CI](https://warden-ci-dvk5.onrender.com) runs on pull requests, moved
upstream to the editor.

## What it does

- **JavaScript / TypeScript** — inspects `import`, `require()`, and dynamic `import()`
  specifiers and resolves them to their installable npm package name.
- **Python** — inspects `import x`, `import x.y as z`, `import a, b, c`, and
  `from x import y`, mapping common modules (e.g. `yaml` → `pyyaml`) to their PyPI
  project name and skipping the standard library.
- Each imported package is checked against the Warden backend, which decides whether it
  is **hallucinated** (not on the registry), a **typosquat** of a popular package, a
  **dependency-confusion** suspect, or a **maintainer-takeover** suspect, and surfaces
  the result as an editor diagnostic.

Detection runs server-side, so **no source code leaves your machine** — only a package
name and ecosystem are sent — and the heuristics improve without an extension update.

## Free vs. Pro

| Capability | Free | Pro |
| --- | --- | --- |
| Import diagnostics (hallucinated / typosquat / confusion) | ✓ | ✓ |
| Quick Fix code actions (review in dashboard, copy remediation) | | ✓ |

Sign in with **Warden: Sign in** (opens GitHub in your browser). The status bar shows
your Free/Pro state; **Warden: Manage plan** opens the upgrade page.

## Commands

| Command | Description |
| --- | --- |
| `Warden: Scan Active File` | Re-scan the current file on demand. |
| `Warden: Sign in` | Authenticate with GitHub to enable Pro features. |
| `Warden: Sign out` | Clear the stored Warden session. |
| `Warden: Manage plan` | Open the Warden subscription page. |

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `wardenCheck.enabled` | `true` | Scan supported files for suspicious imports. |
| `wardenCheck.serverUrl` | `https://warden-ci-dvk5.onrender.com` | Base URL of the Warden backend. |

## Privacy

Your Warden session token is stored in VS Code's [SecretStorage](https://code.visualstudio.com/api/references/vscode-api#SecretStorage),
never in plain settings. Package checks send only the package name and ecosystem.

## Development

```bash
npm install
npm run compile   # or: npm run watch
npm test          # compiles and runs the unit tests
npm run package   # builds a .vsix with vsce
```
