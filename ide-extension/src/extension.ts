/**
 * Warden Check — VS Code extension (MVP scaffold, point-4 deliverable).
 *
 * This is deliberately minimal and NOT a copy-paste of src/scan — it's a
 * standalone extension because it runs client-side, in a different runtime
 * (VS Code's extension host), on a different trigger (as you type/save,
 * not on PR diff), and needs its own debouncing so it doesn't hammer the
 * npm/PyPI registries on every keystroke. Treat this as the starting point
 * for the real thing, not the real thing itself:
 *
 *  - Only checks npm imports for now (no PyPI parity yet).
 *  - No typosquat/freshness signal yet — existence check only.
 *  - Not published anywhere. Publishing requires a publisher account on the
 *    VS Code Marketplace (or Open VSX for other editors) — that's an account
 *    you'd need to create; nothing about that step can be done for you.
 *
 * Why this is worth building at all, even at this scope: distribution here
 * happens where the hallucination is actually introduced — the moment a
 * developer accepts an AI suggestion — rather than after it's already
 * committed and pushed. That's a harder position for a competitor to match
 * with a PR-only tool, which is the actual point-4 thesis.
 */

import * as vscode from "vscode";

const IMPORT_PATTERNS = [
  /\bfrom\s+['"]([^'"]+)['"]/g,
  /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,
];

const DEBOUNCE_MS = 800;
const diagnostics = vscode.languages.createDiagnosticCollection("warden-check");
const npmExistenceCache = new Map<string, boolean>(); // avoids re-checking the same package repeatedly in one session
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function packageNameFromSpecifier(specifier: string): string | null {
  if (specifier.startsWith(".") || specifier.startsWith("/") || specifier.startsWith("http")) return null;
  const parts = specifier.split("/");
  if (specifier.startsWith("@")) return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : null;
  return parts[0] || null;
}

async function existsOnNpm(pkg: string): Promise<boolean> {
  if (npmExistenceCache.has(pkg)) return npmExistenceCache.get(pkg)!;
  try {
    const encoded = pkg.startsWith("@") ? `@${encodeURIComponent(pkg.slice(1))}` : encodeURIComponent(pkg);
    const res = await fetch(`https://registry.npmjs.org/${encoded}`, { method: "HEAD" });
    npmExistenceCache.set(pkg, res.ok);
    return res.ok;
  } catch {
    return true; // fail open — a network blip shouldn't flag a real package
  }
}

async function scanDocument(doc: vscode.TextDocument): Promise<void> {
  if (!["javascript", "typescript", "javascriptreact", "typescriptreact"].includes(doc.languageId)) {
    diagnostics.delete(doc.uri);
    return;
  }

  const text = doc.getText();
  const found: Array<{ pkg: string; range: vscode.Range }> = [];

  for (const pattern of IMPORT_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const pkg = packageNameFromSpecifier(match[1]);
      if (!pkg) continue;
      const start = doc.positionAt(match.index);
      const end = doc.positionAt(match.index + match[0].length);
      found.push({ pkg, range: new vscode.Range(start, end) });
    }
  }

  const results = await Promise.all(found.map((f) => existsOnNpm(f.pkg)));
  const issues: vscode.Diagnostic[] = [];
  found.forEach((f, i) => {
    if (!results[i]) {
      const diagnostic = new vscode.Diagnostic(
        f.range,
        `Package "${f.pkg}" was not found on the npm registry — possible hallucinated package name. Verify before installing.`,
        vscode.DiagnosticSeverity.Warning
      );
      diagnostic.source = "Warden Check";
      issues.push(diagnostic);
    }
  });

  diagnostics.set(doc.uri, issues);
}

function scheduleDocumentScan(doc: vscode.TextDocument): void {
  const key = doc.uri.toString();
  const existing = timers.get(key);
  if (existing) clearTimeout(existing);
  timers.set(
    key,
    setTimeout(() => {
      timers.delete(key);
      scanDocument(doc).catch((err) => console.error("Warden Check scan failed:", err));
    }, DEBOUNCE_MS)
  );
}

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(diagnostics);

  if (vscode.window.activeTextEditor) {
    scanDocument(vscode.window.activeTextEditor.document);
  }

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(scanDocument),
    vscode.workspace.onDidSaveTextDocument(scanDocument),
    vscode.workspace.onDidChangeTextDocument((e) => scheduleDocumentScan(e.document))
  );
}

export function deactivate(): void {
  diagnostics.dispose();
}
