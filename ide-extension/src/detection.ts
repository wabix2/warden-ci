/**
 * Import parsing for Warden Check.
 *
 * This module is deliberately free of any `vscode` dependency so it can be unit
 * tested under plain Node. It only decides *which package names* are imported and
 * *where* — the actual risk decision (hallucinated / typosquat / etc.) is made
 * server-side by src/scan/riskSignals.ts, reached through the backend
 * /api/check/package endpoint, so the heuristics live in exactly one place.
 */

import { builtinModules } from "module";

export type ExtensionEcosystem = "npm" | "pypi" | "cargo" | "go";

export interface DetectedImport {
  ecosystem: ExtensionEcosystem;
  /** Registry package name (already mapped from import name where they differ). */
  packageName: string;
  /** Zero-based line index. */
  line: number;
  /** Zero-based start column of the highlighted token. */
  startCol: number;
  /** Zero-based end column of the highlighted token. */
  endCol: number;
}

const NODE_BUILTINS = new Set([...builtinModules, ...builtinModules.map((m) => `node:${m}`)]);

const JS_LANGUAGES = new Set(["javascript", "typescript", "javascriptreact", "typescriptreact"]);

export function ecosystemForLanguage(languageId: string): ExtensionEcosystem | null {
  if (JS_LANGUAGES.has(languageId)) return "npm";
  if (languageId === "python") return "pypi";
  if (languageId === "rust") return "cargo";
  if (languageId === "go") return "go";
  return null;
}

// Mirrors src/scan/ecosystems/npm.ts: skip relative/absolute/URL specifiers and
// collapse scoped and sub-path specifiers down to the installable package name.
export function npmPackageFromSpecifier(specifier: string): string | null {
  if (specifier.startsWith(".") || specifier.startsWith("/") || specifier.startsWith("http:") || specifier.startsWith("https:")) return null;
  const parts = specifier.split("/");
  if (specifier.startsWith("@")) return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : null;
  return parts[0] || null;
}

const NPM_IMPORT_PATTERNS = [
  /\bfrom\s+['"]([^'"]+)['"]/g,
  /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
];

// Copied from src/scan/ecosystems/pythonStdlib.ts. This is parsing-side data (what to
// skip), not detection logic, so keeping a local copy avoids a network round-trip for
// every `import os` while the risk heuristics still live only on the server.
const PYTHON_STDLIB = new Set([
  "abc", "argparse", "array", "ast", "asyncio", "atexit", "base64", "bisect",
  "builtins", "calendar", "collections", "colorsys", "compileall", "concurrent",
  "configparser", "contextlib", "contextvars", "copy", "copyreg", "csv", "ctypes",
  "dataclasses", "datetime", "decimal", "difflib", "dis", "doctest", "email",
  "encodings", "enum", "errno", "faulthandler", "fcntl", "filecmp", "fileinput",
  "fnmatch", "fractions", "ftplib", "functools", "gc", "getopt", "getpass",
  "gettext", "glob", "graphlib", "gzip", "hashlib", "heapq", "hmac", "html",
  "http", "idlelib", "imaplib", "importlib", "inspect", "io", "ipaddress",
  "itertools", "json", "keyword", "linecache", "locale", "logging", "lzma",
  "mailbox", "marshal", "math", "mimetypes", "mmap", "modulefinder",
  "multiprocessing", "netrc", "os", "operator", "optparse", "pathlib",
  "pdb", "pickle", "pickletools", "pkgutil", "platform", "plistlib", "poplib",
  "pprint", "profile", "pstats", "pty", "pwd", "py_compile", "pyclbr",
  "pydoc", "queue", "quopri", "random", "re", "reprlib", "resource",
  "sched", "secrets", "select", "selectors", "shelve", "shlex", "shutil",
  "signal", "site", "smtplib", "socket", "socketserver", "sqlite3", "ssl",
  "stat", "statistics", "string", "stringprep", "struct", "subprocess",
  "sys", "sysconfig", "syslog", "tarfile", "tempfile", "termios", "textwrap",
  "threading", "time", "timeit", "tkinter", "token", "tokenize", "tomllib",
  "trace", "traceback", "tracemalloc", "tty", "turtle", "types", "typing",
  "unicodedata", "unittest", "urllib", "uuid", "venv", "warnings", "wave",
  "weakref", "webbrowser", "wsgiref", "xml", "xmlrpc", "zipapp", "zipfile",
  "zipimport", "zlib", "zoneinfo", "__future__",
]);

// Common cases where the imported module name differs from the PyPI project name.
// Kept in sync with src/scan/ecosystems/pypi.ts.
const PYTHON_IMPORT_TO_PACKAGE: Record<string, string> = {
  yaml: "pyyaml",
  cv2: "opencv-python",
  bs4: "beautifulsoup4",
  sklearn: "scikit-learn",
  PIL: "pillow",
  jwt: "pyjwt",
  dotenv: "python-dotenv",
};

const PY_FROM = /^\s*from\s+(\.*)([a-zA-Z_][a-zA-Z0-9_.]*)\s+import\b/;
const PY_IMPORT = /^\s*import\s+(.+)$/;

function pushUnique(out: DetectedImport[], seen: Set<string>, entry: DetectedImport): void {
  const key = `${entry.ecosystem}:${entry.packageName}:${entry.line}`;
  if (seen.has(key)) return;
  seen.add(key);
  out.push(entry);
}

function parseNpmLine(content: string, lineIdx: number, out: DetectedImport[], seen: Set<string>): void {
  for (const pattern of NPM_IMPORT_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content)) !== null) {
      const specifier = match[1];
      const pkg = npmPackageFromSpecifier(specifier);
      if (!pkg || NODE_BUILTINS.has(pkg)) continue;
      const specifierStart = match.index + match[0].indexOf(specifier);
      pushUnique(out, seen, { ecosystem: "npm", packageName: pkg, line: lineIdx, startCol: specifierStart, endCol: specifierStart + specifier.length });
    }
  }
}

function addPythonModule(moduleName: string, content: string, lineIdx: number, out: DetectedImport[], seen: Set<string>): void {
  if (!moduleName || PYTHON_STDLIB.has(moduleName)) return;
  const pkg = PYTHON_IMPORT_TO_PACKAGE[moduleName] || moduleName;
  const start = Math.max(0, content.indexOf(moduleName));
  pushUnique(out, seen, { ecosystem: "pypi", packageName: pkg, line: lineIdx, startCol: start, endCol: start + moduleName.length });
}

function parsePythonLine(content: string, lineIdx: number, out: DetectedImport[], seen: Set<string>): void {
  const fromMatch = PY_FROM.exec(content);
  if (fromMatch) {
    if (fromMatch[1]) return; // leading dots => relative import, not a published package
    addPythonModule(fromMatch[2].split(".")[0], content, lineIdx, out, seen);
    return;
  }
  const importMatch = PY_IMPORT.exec(content);
  if (!importMatch) return;
  // `import a, b.c as d, e` — split on commas, take the top-level module of each,
  // dropping any `as` alias.
  const body = importMatch[1].split("#")[0];
  for (const part of body.split(",")) {
    const token = part.trim().split(/\s+/)[0];
    if (!token || token.startsWith(".")) continue;
    const module = token.split(".")[0];
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(module)) continue;
    addPythonModule(module, content, lineIdx, out, seen);
  }
}

function parseCargoLine(content: string, lineIdx: number, out: DetectedImport[], seen: Set<string>): void {
  const match = /^\s*(?:use|extern\s+crate)\s+([a-zA-Z][a-zA-Z0-9_-]*)/.exec(content);
  if (!match || ["std", "core", "alloc", "crate", "self", "super"].includes(match[1])) return;
  const start = content.indexOf(match[1]);
  pushUnique(out, seen, { ecosystem: "cargo", packageName: match[1].replace(/_/g, "-"), line: lineIdx, startCol: start, endCol: start + match[1].length });
}

function parseGoLine(content: string, lineIdx: number, out: DetectedImport[], seen: Set<string>): void {
  if (!/^\s*import\b/.test(content)) return;
  for (const match of content.matchAll(/"([^"]+)"/g)) {
    const path = match[1];
    if (!path.includes(".") && !path.includes("/")) continue;
    const pkg = path.split("/").slice(0, 3).join("/");
    pushUnique(out, seen, { ecosystem: "go", packageName: pkg, line: lineIdx, startCol: match.index + 1, endCol: match.index + 1 + path.length });
  }
}

export function parseImports(text: string, ecosystem: ExtensionEcosystem): DetectedImport[] {
  const out: DetectedImport[] = [];
  const seen = new Set<string>();
  text.split(/\r?\n/).forEach((content, lineIdx) => {
    if (ecosystem === "npm") parseNpmLine(content, lineIdx, out, seen);
    else if (ecosystem === "pypi") parsePythonLine(content, lineIdx, out, seen);
    else if (ecosystem === "cargo") parseCargoLine(content, lineIdx, out, seen);
    else parseGoLine(content, lineIdx, out, seen);
  });
  return out;
}
