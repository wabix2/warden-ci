/**
 * Warden CI \u2014 process entrypoint for hosted deployment (Fly.io, Render, Railway, etc.)
 *
 * Two things this handles that `probot run` alone doesn't handle reliably on every host:
 *
 * 1. PRIVATE_KEY newline mangling. Most secret-store UIs (Replit, Render, Railway, Fly)
 *    store multi-line secrets fine, but some paths in/out of the browser clipboard or
 *    CLI escape real newlines as literal "\n" characters. If that happens, the PEM fails
 *    validation. We normalize it here into a real multi-line string and write it to a
 *    temp file, then point Probot at the file via PRIVATE_KEY_PATH \u2014 this sidesteps
 *    the stricter inline-env-var PEM validation entirely.
 *
 * 2. Binding to 0.0.0.0 and the platform-assigned $PORT. Probot's `run()` already reads
 *    HOST/PORT from the environment, but we set sane defaults here so it works the same
 *    way on every host without relying on host-specific config.
 */

import { writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { run } from "probot";
import app from "./index";

function normalizePrivateKey(): void {
  const raw = process.env.PRIVATE_KEY;
  if (!raw) return; // nothing to do; PRIVATE_KEY_PATH may already be set directly

  // Turn literal "\n" sequences into real newlines, in case the secret was pasted
  // or piped through something that escaped them.
  const normalized = raw.includes("\\n") ? raw.replace(/\\n/g, "\n") : raw;

  if (!normalized.includes("-----BEGIN") || !normalized.includes("-----END")) {
    console.error(
      "PRIVATE_KEY does not look like a valid PEM (missing BEGIN/END markers). " +
        "Re-copy the full .pem file contents into your secret store."
    );
    return;
  }

  const keyPath = join(tmpdir(), "warden-ci-private-key.pem");
  writeFileSync(keyPath, normalized, { mode: 0o600 });
  process.env.PRIVATE_KEY_PATH = keyPath;
  delete process.env.PRIVATE_KEY; // avoid Probot preferring the raw (possibly still-escaped) env var
}

normalizePrivateKey();

process.env.HOST = process.env.HOST || "0.0.0.0";
process.env.PORT = process.env.PORT || "3000";

run(app).catch((err) => {
  console.error("Warden CI failed to start:", err);
  process.exit(1);
});
