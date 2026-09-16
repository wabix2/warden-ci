/**
 * Warden CI — GitHub App authentication.
 *
 * A GitHub App authenticates as itself (using GITHUB_APP_ID + GITHUB_PRIVATE_KEY)
 * to mint short-lived, installation-scoped tokens — one per repo/org that has
 * installed the app. We need a fresh Octokit client per installation, so this
 * is a thin cached factory rather than a single global client.
 */

import { Octokit } from "@octokit/rest";
import { createAppAuth } from "@octokit/auth-app";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

// Cache installation clients briefly — installation tokens last ~1 hour, but we
// don't want a client to outlive that, so we key on installationId and let
// Octokit's built-in auth-app strategy handle refreshing the token as needed.
const clientCache = new Map<number, Octokit>();

export function getInstallationClient(installationId: number): Octokit {
  const cached = clientCache.get(installationId);
  if (cached) return cached;

  const appId = requiredEnv("GITHUB_APP_ID");
  // .replace handles private keys pasted with literal "\n" instead of real newlines,
  // which is a common copy-paste artifact from platform dashboards / env files.
  const privateKey = requiredEnv("GITHUB_PRIVATE_KEY").replace(/\\n/g, "\n");

  const client = new Octokit({
    authStrategy: createAppAuth,
    auth: { appId, privateKey, installationId },
  });

  clientCache.set(installationId, client);
  return client;
}
