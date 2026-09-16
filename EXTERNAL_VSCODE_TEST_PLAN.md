# External VS Code Test Plan

Status: `UNVERIFIED` until a real clean VS Code executable installs and runs the generated VSIX.

## Procedure

1. Build the extension package: `cd ide-extension && npm run package`.
2. Create a fresh temporary VS Code profile and workspace.
3. Install the generated `.vsix` through the Extensions UI or `code --install-extension <file>.vsix`.
4. Configure the Warden server URL and open the controlled demo workspace.
5. Verify a legitimate dependency produces no dangerous warning.
6. Verify a nonexistent dependency produces an explicit unverified/unknown warning.
7. Simulate registry unavailability and verify UNKNOWN/unavailable behavior.
8. Edit rapidly and confirm stale results cannot replace newer diagnostics.
9. Close a document during an active request and confirm cancellation.
10. Restart the extension and workspace; confirm diagnostics recover without stale state.
11. Inspect developer logs for understandable network errors and absence of source-code uploads.
12. Uninstall the extension and confirm requests stop.

## Expected evidence

Capture VS Code version, extension version, activation result, command/configuration behavior, diagnostic messages, request traces with secrets redacted, and pass/fail output. A TypeScript compile, unit suite, or VSIX zip alone is not an external installation proof.

## Current status

The repository verifies compilation, package creation, manifest inspection, and local extension tests. A clean VS Code executable/environment is not available in the current evidence, so external installation remains `UNVERIFIED`.
