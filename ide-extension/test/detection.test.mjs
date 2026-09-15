import test from "node:test";
import assert from "node:assert/strict";
import { parseImports, npmPackageFromSpecifier, ecosystemForLanguage } from "../out/detection.js";

test("ecosystemForLanguage maps editor language ids", () => {
  assert.equal(ecosystemForLanguage("typescriptreact"), "npm");
  assert.equal(ecosystemForLanguage("python"), "pypi");
  assert.equal(ecosystemForLanguage("plaintext"), null);
});

test("npmPackageFromSpecifier collapses scoped and sub-path specifiers", () => {
  assert.equal(npmPackageFromSpecifier("lodash"), "lodash");
  assert.equal(npmPackageFromSpecifier("lodash/fp"), "lodash");
  assert.equal(npmPackageFromSpecifier("@scope/pkg/deep"), "@scope/pkg");
  assert.equal(npmPackageFromSpecifier("./local"), null);
  assert.equal(npmPackageFromSpecifier("../up"), null);
  assert.equal(npmPackageFromSpecifier("https://cdn/x"), null);
});

test("parseImports (npm) finds import/require/dynamic-import and skips builtins/relatives", () => {
  const source = [
    "import express from 'express'",              // line 0
    "const fs = require('fs')",                    // line 1 (builtin, skipped)
    "const p = require('node:path')",              // line 2 (builtin, skipped)
    "import lodash from 'lodash/fp'",              // line 3 -> lodash
    "const m = await import('@scope/pkg/sub')",    // line 4 -> @scope/pkg
    "import x from './local'",                     // line 5 (relative, skipped)
  ].join("\n");
  const found = parseImports(source, "npm");
  const names = found.map((f) => f.packageName).sort();
  assert.deepEqual(names, ["@scope/pkg", "express", "lodash"]);
});

test("parseImports (npm) reports the specifier range", () => {
  const found = parseImports("import express from 'express'", "npm");
  assert.equal(found.length, 1);
  const [imp] = found;
  assert.equal(imp.line, 0);
  // The highlighted token is the specifier text `express` inside the quotes.
  assert.equal("import express from 'express'".slice(imp.startCol, imp.endCol), "express");
});

test("parseImports (pypi) handles import forms, aliases, multi-imports and mapping", () => {
  const source = [
    "import requests",                    // line 0 -> requests
    "import os",                          // line 1 (stdlib, skipped)
    "import numpy as np",                 // line 2 -> numpy
    "import yaml",                        // line 3 -> pyyaml (mapped)
    "from django.db import models",       // line 4 -> django
    "from . import helpers",              // line 5 (relative, skipped)
    "import pandas, click",               // line 6 -> pandas, click
  ].join("\n");
  const names = parseImports(source, "pypi").map((f) => f.packageName).sort();
  assert.deepEqual(names, ["click", "django", "numpy", "pandas", "pyyaml", "requests"]);
});

test("parseImports dedupes the same package on the same line", () => {
  const found = parseImports("import a from 'lodash'; const b = require('lodash')", "npm");
  assert.equal(found.filter((f) => f.packageName === "lodash").length, 1);
});
