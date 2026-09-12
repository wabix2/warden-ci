/**
 * Warden Check — VS Code extension (MVP scaffold, point-4 deliverable).
 *
 * Warden runs at the point where AI-generated imports are accepted, then
 * mirrors the core package-risk signals without uploading source code.
 */

import * as vscode from "vscode";

const IMPORT_PATTERNS = [
  /\bfrom\s+['"]([^'"]+)['"]/g,
  /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,
];

const DEBOUNCE_MS = 800;
const diagnostics = vscode.languages.createDiagnosticCollection("warden-check");
const npmExistenceCache = new Map<string, { exists: boolean; publishedDaysAgo?: number }>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function packageNameFromSpecifier(specifier: string): string | null {
  if (specifier.startsWith(".") || specifier.startsWith("/") || specifier.startsWith("http")) return null;
  const parts = specifier.split("/");
  if (specifier.startsWith("@")) return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : null;
  return parts[0] || null;
}

async function getNpmMetadata(pkg: string): Promise<{ exists: boolean; publishedDaysAgo?: number }> {
  const cached = npmExistenceCache.get(pkg);
  if (cached) return cached;
  try {
    const encoded = pkg.startsWith("@") ? `@${encodeURIComponent(pkg.slice(1))}` : encodeURIComponent(pkg);
    const res = await fetch(`https://registry.npmjs.org/${encoded}`);
    if (res.status === 404) return { exists: false };
    if (!res.ok) return { exists: true };
    const data = await res.json() as { time?: { created?: string } };
    const created = data.time?.created;
    const result = { exists: true, publishedDaysAgo: created ? Math.floor((Date.now() - Date.parse(created)) / 86400000) : undefined };
    npmExistenceCache.set(pkg, result);
    return result;
  } catch {
    return { exists: true };
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

  const results = await Promise.all(found.map((f) => getNpmMetadata(f.pkg)));
  const issues: vscode.Diagnostic[] = [];
  found.forEach((f, i) => {
    const metadata = results[i];
    if (!metadata.exists || (metadata.publishedDaysAgo !== undefined && metadata.publishedDaysAgo <= 45)) {
      const message = !metadata.exists
        ? `Package "${f.pkg}" was not found on npm — possible hallucinated package. Verify before installing.`
        : `Package "${f.pkg}" is very new (${metadata.publishedDaysAgo} day(s) old). Confirm the publisher and repository before installing.`;
      const diagnostic = new vscode.Diagnostic(
        f.range,
        message,
        !metadata.exists ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning
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
    vscode.commands.registerCommand("wardenCheck.scanActiveFile", () => {
      const editor = vscode.window.activeTextEditor;
      if (editor) return scanDocument(editor.document);
    }),
    vscode.workspace.onDidOpenTextDocument(scanDocument),
    vscode.workspace.onDidSaveTextDocument(scanDocument),
    vscode.workspace.onDidChangeTextDocument((e) => scheduleDocumentScan(e.document))
  );
}

export function deactivate(): void {
  diagnostics.dispose();
}
