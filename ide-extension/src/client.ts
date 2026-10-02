/**
 * Thin HTTP client for the Warden backend.
 *
 * Kept `vscode`-free and with an injectable `fetch` so it can be unit tested with a
 * mocked network. All package-risk logic is server-side; this just carries a package
 * name + ecosystem there and reads the verdict back.
 */

export type PackageVerdict = "hallucinated" | "typosquat-suspect" | "dependency-confusion-suspect" | "maintainer-takeover-suspect" | "registry-unavailable" | "known-malware";

export interface CheckResult {
  ok: boolean;
  flagged: boolean;
  ecosystem: string;
  name: string;
  verdict?: PackageVerdict;
  impersonating?: string;
  publishedDaysAgo?: number;
  severity?: "error" | "warning";
  message?: string;
  remediation?: string;
  degraded?: boolean;
}

export interface CliStatus {
  ok: boolean;
  login?: string;
  plan?: string;
  pro?: boolean;
}

type FetchLike = typeof fetch;

function trimBase(serverUrl: string): string {
  return serverUrl.replace(/\/+$/, "");
}

export async function checkPackage(serverUrl: string, ecosystem: string, name: string, fetchImpl: FetchLike = fetch, signal?: AbortSignal): Promise<CheckResult> {
  const url = `${trimBase(serverUrl)}/api/check/package?ecosystem=${encodeURIComponent(ecosystem)}&name=${encodeURIComponent(name)}`;
  const response = await fetchImpl(url, { signal });
  if (!response.ok) throw new Error(`Warden package check failed (${response.status})`);
  return (await response.json()) as CheckResult;
}

export async function fetchCliStatus(serverUrl: string, token: string, fetchImpl: FetchLike = fetch): Promise<CliStatus> {
  const response = await fetchImpl(`${trimBase(serverUrl)}/api/cli/status`, {
    headers: { Cookie: `warden_session=${token}` },
  });
  if (response.status === 401) return { ok: false };
  if (!response.ok) throw new Error(`Warden status check failed (${response.status})`);
  return (await response.json()) as CliStatus;
}

export interface CliSessionPoll {
  ok: boolean;
  pending: boolean;
  token?: string;
}

export async function pollCliSession(serverUrl: string, state: string, fetchImpl: FetchLike = fetch): Promise<CliSessionPoll> {
  const response = await fetchImpl(`${trimBase(serverUrl)}/api/cli/session?state=${encodeURIComponent(state)}`);
  if (!response.ok) throw new Error(`Warden sign-in poll failed (${response.status})`);
  return (await response.json()) as CliSessionPoll;
}
