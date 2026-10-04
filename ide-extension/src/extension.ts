/**
 * Warden Check — VS Code extension.
 *
 * Flags hallucinated / typosquat / dependency-confusion package imports as you type,
 * across JavaScript, TypeScript, and Python. Detection runs server-side (the same
 * engine Warden CI runs on pull requests) via /api/check/package, so no source code
 * leaves the editor — only a package name and ecosystem.
 *
 * Free tier: diagnostics only.
 * Pro tier: unlocks Quick Fix code actions on flagged imports.
 *
 * Quick Fix design decision — the ad hoc endpoint vs. dashboard question in the spec:
 * we chose to open the linked dashboard rather than call the verified auto-fix flow.
 * The backend's /api/runs/:runId/findings/:findingId/fix requires a runId + findingId
 * from a stored scan of a real pull request, plus an OSV-derived fixed version. An
 * in-editor import has none of that context, and hallucinated/typosquat findings have
 * no deterministic "fixed version" to bump to — the remediation is human verification.
 * So the Pro Quick Fix surfaces the remediation guidance and opens the dashboard, where
 * the full PR-scoped verified-fix workflow actually lives.
 */

import * as vscode from "vscode";
import { randomBytes } from "crypto";
import { parseImports, ecosystemForLanguage, DetectedImport, ExtensionEcosystem } from "./detection";
import { checkPackage, fetchCliStatus, pollCliSession, CheckResult } from "./client";

const DEFAULT_SERVER_URL = "https://warden-ci-dvk5.onrender.com";
const SECRET_SESSION_KEY = "warden.sessionToken";
const DEBOUNCE_MS = 800;
const DIAGNOSTIC_SOURCE = "Warden Check";

const diagnostics = vscode.languages.createDiagnosticCollection("warden-check");
const timers = new Map<string, ReturnType<typeof setTimeout>>();
// Cache verdicts for the session so re-scans on every keystroke don't re-hit the
// backend for packages we already know about.
const CACHE_TTL_MS = 15 * 60 * 1000;
const verdictCache = new Map<string, { result: CheckResult; expiresAt: number }>();

interface FlaggedImport {
  range: vscode.Range;
  packageName: string;
  ecosystem: ExtensionEcosystem;
  remediation: string;
  message: string;
}
const flaggedByDoc = new Map<string, FlaggedImport[]>();
const scanGeneration = new Map<string, number>();
const scanControllers = new Map<string, AbortController>();

let isPro = false;
let statusBarItem: vscode.StatusBarItem;

function serverUrl(): string {
  const configured = vscode.workspace.getConfiguration("wardenCheck").get<string>("serverUrl");
  return (configured && configured.trim()) || DEFAULT_SERVER_URL;
}

function extensionEnabled(): boolean {
  return vscode.workspace.getConfiguration("wardenCheck").get<boolean>("enabled", true);
}

async function checkWithCache(ecosystem: ExtensionEcosystem, name: string, signal: AbortSignal): Promise<CheckResult | null> {
  const key = `${ecosystem}:${name}`;
  const cached = verdictCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.result;
  if (cached) verdictCache.delete(key);
  try {
    const result = await checkPackage(serverUrl(), ecosystem, name, fetch, signal);
    verdictCache.set(key, { result, expiresAt: Date.now() + CACHE_TTL_MS });
    return result;
  } catch (error) {
    // Network/registry outage must never become a false finding — skip silently.
    console.error("Warden Check package lookup failed:", error);
    return null;
  }
}

async function scanDocument(doc: vscode.TextDocument): Promise<void> {
  const documentKey = doc.uri.toString();
  const generation = (scanGeneration.get(documentKey) ?? 0) + 1;
  scanGeneration.set(documentKey, generation);
  scanControllers.get(documentKey)?.abort();
  const controller = new AbortController();
  scanControllers.set(documentKey, controller);
  const ecosystem = ecosystemForLanguage(doc.languageId);
  if (!ecosystem || !extensionEnabled()) {
    diagnostics.delete(doc.uri);
    flaggedByDoc.delete(doc.uri.toString());
    return;
  }

  const imports = parseImports(doc.getText(), ecosystem);
  const uniqueNames = [...new Set(imports.map((i) => i.packageName))];
  const results = new Map<string, CheckResult | null>();
  await Promise.all(uniqueNames.map(async (name) => results.set(name, await checkWithCache(ecosystem, name, controller.signal))));

  if (scanGeneration.get(documentKey) !== generation) return;
  if (scanControllers.get(documentKey) === controller) scanControllers.delete(documentKey);
  const issues: vscode.Diagnostic[] = [];
  const flagged: FlaggedImport[] = [];
  for (const imp of imports) {
    const result = results.get(imp.packageName);
    if (!result || !result.flagged) continue;
    const range = new vscode.Range(imp.line, imp.startCol, imp.line, imp.endCol);
    const severity = result.severity === "warning" ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Error;
    const diagnostic = new vscode.Diagnostic(range, result.message || `Warden flagged "${imp.packageName}".`, severity);
    diagnostic.source = DIAGNOSTIC_SOURCE;
    diagnostic.code = result.verdict;
    issues.push(diagnostic);
    flagged.push({ range, packageName: imp.packageName, ecosystem, remediation: result.remediation || "Verify the package before installing.", message: result.message || "" });
  }

  diagnostics.set(doc.uri, issues);
  flaggedByDoc.set(doc.uri.toString(), flagged);
}

function scheduleDocumentScan(doc: vscode.TextDocument): void {
  const key = doc.uri.toString();
  const existing = timers.get(key);
  if (existing) clearTimeout(existing);
  timers.set(key, setTimeout(() => {
    timers.delete(key);
    scanDocument(doc).catch((err) => console.error("Warden Check scan failed:", err));
  }, DEBOUNCE_MS));
}

// --- Authentication + Pro status ------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function refreshStatus(context: vscode.ExtensionContext): Promise<void> {
  const token = await context.secrets.get(SECRET_SESSION_KEY);
  if (!token) {
    isPro = false;
    statusBarItem.text = "$(shield) Warden: Sign in";
    statusBarItem.tooltip = "Sign in to Warden to enable Pro features";
    statusBarItem.command = "wardenCheck.signIn";
    statusBarItem.show();
    return;
  }
  try {
    const status = await fetchCliStatus(serverUrl(), token);
    if (!status.ok) {
      // Session expired or revoked — drop it and fall back to the signed-out state.
      await context.secrets.delete(SECRET_SESSION_KEY);
      isPro = false;
      statusBarItem.text = "$(shield) Warden: Sign in";
      statusBarItem.tooltip = "Your Warden session expired — sign in again";
      statusBarItem.command = "wardenCheck.signIn";
    } else {
      isPro = Boolean(status.pro);
      statusBarItem.text = isPro ? "$(shield) Warden: Pro" : "$(shield) Warden: Free";
      statusBarItem.tooltip = isPro
        ? `Signed in as ${status.login ?? "you"} — Pro features enabled`
        : `Signed in as ${status.login ?? "you"} — upgrade to unlock Quick Fixes`;
      statusBarItem.command = "wardenCheck.managePlan";
    }
  } catch (error) {
    console.error("Warden Check status refresh failed:", error);
    statusBarItem.text = "$(shield) Warden: offline";
    statusBarItem.tooltip = "Could not reach the Warden backend";
    statusBarItem.command = "wardenCheck.signIn";
  }
  statusBarItem.show();
}

async function signIn(context: vscode.ExtensionContext): Promise<void> {
  const state = randomBytes(24).toString("hex");
  const authUrl = `${serverUrl().replace(/\/+$/, "")}/auth/github?cli=${state}`;
  await vscode.env.openExternal(vscode.Uri.parse(authUrl));

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: "Warden: waiting for GitHub sign-in…", cancellable: true },
    async (_progress, cancellation) => {
      // Poll the one-time handoff endpoint until the browser flow completes.
      for (let attempt = 0; attempt < 60 && !cancellation.isCancellationRequested; attempt += 1) {
        await sleep(2000);
        try {
          const poll = await pollCliSession(serverUrl(), state);
          if (poll.token) {
            await context.secrets.store(SECRET_SESSION_KEY, poll.token);
            await refreshStatus(context);
            vscode.window.showInformationMessage("Signed in to Warden.");
            return;
          }
        } catch (error) {
          console.error("Warden Check sign-in poll failed:", error);
        }
      }
      if (!cancellation.isCancellationRequested) {
        vscode.window.showWarningMessage("Warden sign-in timed out. Run “Warden: Sign in” to try again.");
      }
    }
  );
}

async function signOut(context: vscode.ExtensionContext): Promise<void> {
  await context.secrets.delete(SECRET_SESSION_KEY);
  await refreshStatus(context);
  vscode.window.showInformationMessage("Signed out of Warden.");
}

// --- Quick Fix (Pro) -------------------------------------------------------------

class WardenCodeActionProvider implements vscode.CodeActionProvider {
  static readonly providedKinds = [vscode.CodeActionKind.QuickFix];

  provideCodeActions(document: vscode.TextDocument, range: vscode.Range | vscode.Selection, context: vscode.CodeActionContext): vscode.CodeAction[] {
    if (!isPro) return [];
    const wardenDiagnostics = context.diagnostics.filter((d) => d.source === DIAGNOSTIC_SOURCE);
    if (wardenDiagnostics.length === 0) return [];
    const entries = flaggedByDoc.get(document.uri.toString()) || [];
    const actions: vscode.CodeAction[] = [];
    for (const diagnostic of wardenDiagnostics) {
      const entry = entries.find((e) => e.range.isEqual(diagnostic.range)) || entries.find((e) => e.range.intersection(range));
      if (!entry) continue;

      const open = new vscode.CodeAction(`Warden: Review "${entry.packageName}" in dashboard`, vscode.CodeActionKind.QuickFix);
      open.diagnostics = [diagnostic];
      open.command = { command: "wardenCheck.openDashboard", title: "Open Warden dashboard" };
      actions.push(open);

      const guidance = new vscode.CodeAction(`Warden: Copy remediation guidance`, vscode.CodeActionKind.QuickFix);
      guidance.diagnostics = [diagnostic];
      guidance.command = { command: "wardenCheck.copyRemediation", title: "Copy remediation", arguments: [entry.remediation] };
      actions.push(guidance);
    }
    return actions;
  }
}

export function activate(context: vscode.ExtensionContext): void {
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  context.subscriptions.push(diagnostics, statusBarItem);

  if (vscode.window.activeTextEditor) scanDocument(vscode.window.activeTextEditor.document);
  void refreshStatus(context);

  context.subscriptions.push(
    vscode.commands.registerCommand("wardenCheck.scanActiveFile", () => {
      const editor = vscode.window.activeTextEditor;
      if (editor) return scanDocument(editor.document);
    }),
    vscode.commands.registerCommand("wardenCheck.signIn", () => signIn(context)),
    vscode.commands.registerCommand("wardenCheck.signOut", () => signOut(context)),
    vscode.commands.registerCommand("wardenCheck.managePlan", () => vscode.env.openExternal(vscode.Uri.parse(`${serverUrl().replace(/\/+$/, "")}/subscribe?plan=pro`))),
    vscode.commands.registerCommand("wardenCheck.openDashboard", () => vscode.env.openExternal(vscode.Uri.parse(`${serverUrl().replace(/\/+$/, "")}/dashboard`))),
    vscode.commands.registerCommand("wardenCheck.copyRemediation", async (remediation?: string) => {
      await vscode.env.clipboard.writeText(remediation || "Verify the package before installing.");
      vscode.window.showInformationMessage("Warden remediation guidance copied to clipboard.");
    }),
    vscode.languages.registerCodeActionsProvider(
      [{ language: "javascript" }, { language: "typescript" }, { language: "javascriptreact" }, { language: "typescriptreact" }, { language: "python" }, { language: "rust" }, { language: "go" }],
      new WardenCodeActionProvider(),
      { providedCodeActionKinds: WardenCodeActionProvider.providedKinds }
    ),
    vscode.workspace.onDidOpenTextDocument(scanDocument),
    vscode.workspace.onDidSaveTextDocument(scanDocument),
    vscode.workspace.onDidChangeTextDocument((e) => scheduleDocumentScan(e.document)),
    vscode.workspace.onDidCloseTextDocument((doc) => {
      diagnostics.delete(doc.uri);
      flaggedByDoc.delete(doc.uri.toString());
      scanGeneration.delete(doc.uri.toString());
    })
  );
}

export function deactivate(): void {
  for (const controller of scanControllers.values()) controller.abort();
  scanControllers.clear();
  diagnostics.dispose();
  statusBarItem?.dispose();
}
