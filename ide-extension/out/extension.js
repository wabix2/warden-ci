"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const crypto_1 = require("crypto");
const detection_1 = require("./detection");
const client_1 = require("./client");
const DEFAULT_SERVER_URL = "https://warden-ci-dvk5.onrender.com";
const SECRET_SESSION_KEY = "warden.sessionToken";
const DEBOUNCE_MS = 800;
const DIAGNOSTIC_SOURCE = "Warden Check";
const diagnostics = vscode.languages.createDiagnosticCollection("warden-check");
const timers = new Map();
// Cache verdicts for the session so re-scans on every keystroke don't re-hit the
// backend for packages we already know about.
const CACHE_TTL_MS = 15 * 60 * 1000;
const verdictCache = new Map();
const flaggedByDoc = new Map();
const scanGeneration = new Map();
const scanControllers = new Map();
let isPro = false;
let statusBarItem;
function serverUrl() {
    const configured = vscode.workspace.getConfiguration("wardenCheck").get("serverUrl");
    return (configured && configured.trim()) || DEFAULT_SERVER_URL;
}
function extensionEnabled() {
    return vscode.workspace.getConfiguration("wardenCheck").get("enabled", true);
}
async function checkWithCache(ecosystem, name, signal) {
    const key = `${ecosystem}:${name}`;
    const cached = verdictCache.get(key);
    if (cached && cached.expiresAt > Date.now())
        return cached.result;
    if (cached)
        verdictCache.delete(key);
    try {
        const result = await (0, client_1.checkPackage)(serverUrl(), ecosystem, name, fetch, signal);
        verdictCache.set(key, { result, expiresAt: Date.now() + CACHE_TTL_MS });
        return result;
    }
    catch (error) {
        // Network/registry outage must never become a false finding — skip silently.
        console.error("Warden Check package lookup failed:", error);
        return null;
    }
}
async function scanDocument(doc) {
    const documentKey = doc.uri.toString();
    const generation = (scanGeneration.get(documentKey) ?? 0) + 1;
    scanGeneration.set(documentKey, generation);
    scanControllers.get(documentKey)?.abort();
    const controller = new AbortController();
    scanControllers.set(documentKey, controller);
    const ecosystem = (0, detection_1.ecosystemForLanguage)(doc.languageId);
    if (!ecosystem || !extensionEnabled()) {
        diagnostics.delete(doc.uri);
        flaggedByDoc.delete(doc.uri.toString());
        return;
    }
    const imports = (0, detection_1.parseImports)(doc.getText(), ecosystem);
    const uniqueNames = [...new Set(imports.map((i) => i.packageName))];
    const results = new Map();
    await Promise.all(uniqueNames.map(async (name) => results.set(name, await checkWithCache(ecosystem, name, controller.signal))));
    if (scanGeneration.get(documentKey) !== generation)
        return;
    if (scanControllers.get(documentKey) === controller)
        scanControllers.delete(documentKey);
    const issues = [];
    const flagged = [];
    for (const imp of imports) {
        const result = results.get(imp.packageName);
        if (!result || !result.flagged)
            continue;
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
function scheduleDocumentScan(doc) {
    const key = doc.uri.toString();
    const existing = timers.get(key);
    if (existing)
        clearTimeout(existing);
    timers.set(key, setTimeout(() => {
        timers.delete(key);
        scanDocument(doc).catch((err) => console.error("Warden Check scan failed:", err));
    }, DEBOUNCE_MS));
}
// --- Authentication + Pro status ------------------------------------------------
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
async function refreshStatus(context) {
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
        const status = await (0, client_1.fetchCliStatus)(serverUrl(), token);
        if (!status.ok) {
            // Session expired or revoked — drop it and fall back to the signed-out state.
            await context.secrets.delete(SECRET_SESSION_KEY);
            isPro = false;
            statusBarItem.text = "$(shield) Warden: Sign in";
            statusBarItem.tooltip = "Your Warden session expired — sign in again";
            statusBarItem.command = "wardenCheck.signIn";
        }
        else {
            isPro = Boolean(status.pro);
            statusBarItem.text = isPro ? "$(shield) Warden: Pro" : "$(shield) Warden: Free";
            statusBarItem.tooltip = isPro
                ? `Signed in as ${status.login ?? "you"} — Pro features enabled`
                : `Signed in as ${status.login ?? "you"} — upgrade to unlock Quick Fixes`;
            statusBarItem.command = "wardenCheck.managePlan";
        }
    }
    catch (error) {
        console.error("Warden Check status refresh failed:", error);
        statusBarItem.text = "$(shield) Warden: offline";
        statusBarItem.tooltip = "Could not reach the Warden backend";
        statusBarItem.command = "wardenCheck.signIn";
    }
    statusBarItem.show();
}
async function signIn(context) {
    const state = (0, crypto_1.randomBytes)(24).toString("hex");
    const authUrl = `${serverUrl().replace(/\/+$/, "")}/auth/github?cli=${state}`;
    await vscode.env.openExternal(vscode.Uri.parse(authUrl));
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "Warden: waiting for GitHub sign-in…", cancellable: true }, async (_progress, cancellation) => {
        // Poll the one-time handoff endpoint until the browser flow completes.
        for (let attempt = 0; attempt < 60 && !cancellation.isCancellationRequested; attempt += 1) {
            await sleep(2000);
            try {
                const poll = await (0, client_1.pollCliSession)(serverUrl(), state);
                if (poll.token) {
                    await context.secrets.store(SECRET_SESSION_KEY, poll.token);
                    await refreshStatus(context);
                    vscode.window.showInformationMessage("Signed in to Warden.");
                    return;
                }
            }
            catch (error) {
                console.error("Warden Check sign-in poll failed:", error);
            }
        }
        if (!cancellation.isCancellationRequested) {
            vscode.window.showWarningMessage("Warden sign-in timed out. Run “Warden: Sign in” to try again.");
        }
    });
}
async function signOut(context) {
    await context.secrets.delete(SECRET_SESSION_KEY);
    await refreshStatus(context);
    vscode.window.showInformationMessage("Signed out of Warden.");
}
// --- Quick Fix (Pro) -------------------------------------------------------------
class WardenCodeActionProvider {
    static providedKinds = [vscode.CodeActionKind.QuickFix];
    provideCodeActions(document, range, context) {
        if (!isPro)
            return [];
        const wardenDiagnostics = context.diagnostics.filter((d) => d.source === DIAGNOSTIC_SOURCE);
        if (wardenDiagnostics.length === 0)
            return [];
        const entries = flaggedByDoc.get(document.uri.toString()) || [];
        const actions = [];
        for (const diagnostic of wardenDiagnostics) {
            const entry = entries.find((e) => e.range.isEqual(diagnostic.range)) || entries.find((e) => e.range.intersection(range));
            if (!entry)
                continue;
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
function activate(context) {
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    context.subscriptions.push(diagnostics, statusBarItem);
    if (vscode.window.activeTextEditor)
        scanDocument(vscode.window.activeTextEditor.document);
    void refreshStatus(context);
    context.subscriptions.push(vscode.commands.registerCommand("wardenCheck.scanActiveFile", () => {
        const editor = vscode.window.activeTextEditor;
        if (editor)
            return scanDocument(editor.document);
    }), vscode.commands.registerCommand("wardenCheck.signIn", () => signIn(context)), vscode.commands.registerCommand("wardenCheck.signOut", () => signOut(context)), vscode.commands.registerCommand("wardenCheck.managePlan", () => vscode.env.openExternal(vscode.Uri.parse(`${serverUrl().replace(/\/+$/, "")}/subscribe?plan=pro`))), vscode.commands.registerCommand("wardenCheck.openDashboard", () => vscode.env.openExternal(vscode.Uri.parse(`${serverUrl().replace(/\/+$/, "")}/dashboard`))), vscode.commands.registerCommand("wardenCheck.copyRemediation", async (remediation) => {
        await vscode.env.clipboard.writeText(remediation || "Verify the package before installing.");
        vscode.window.showInformationMessage("Warden remediation guidance copied to clipboard.");
    }), vscode.languages.registerCodeActionsProvider([{ language: "javascript" }, { language: "typescript" }, { language: "javascriptreact" }, { language: "typescriptreact" }, { language: "python" }, { language: "rust" }, { language: "go" }], new WardenCodeActionProvider(), { providedCodeActionKinds: WardenCodeActionProvider.providedKinds }), vscode.workspace.onDidOpenTextDocument(scanDocument), vscode.workspace.onDidSaveTextDocument(scanDocument), vscode.workspace.onDidChangeTextDocument((e) => scheduleDocumentScan(e.document)), vscode.workspace.onDidCloseTextDocument((doc) => {
        diagnostics.delete(doc.uri);
        flaggedByDoc.delete(doc.uri.toString());
        scanGeneration.delete(doc.uri.toString());
    }));
}
function deactivate() {
    for (const controller of scanControllers.values())
        controller.abort();
    scanControllers.clear();
    diagnostics.dispose();
    statusBarItem?.dispose();
}
