import { eq } from "drizzle-orm";
import type { Request } from "express";
import { db } from "../db";
import { installations, repositories, scanRuns } from "../db/schema";
import { getRedisClient } from "../lib/redis";

export type RunAccessResult =
  | { kind: "unauthenticated" }
  | { kind: "not_found" }
  | { kind: "forbidden" }
  | { kind: "authorized"; run: typeof scanRuns.$inferSelect; installationId: number };

export async function sessionTokenFromRequest(req: Request): Promise<string | null> {
  const sessionId = sessionIdFromRequest(req);
  return sessionId ? getRedisClient().get<string>(`warden:oauth:session:${sessionId}`) : null;
}

function sessionIdFromRequest(req: Request): string | undefined {
  const cookie = req.headers.cookie ?? "";
  return cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith("warden_session="))?.slice("warden_session=".length);
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export const REQUIRED_REPOSITORY_PERMISSION = "pull" as const;
export const REQUIRED_WRITE_PERMISSION = "push" as const;

type AuthorizationDependencies = {
  database: any;
  sessionToken: (sessionId: string) => Promise<string | null>;
  githubFetch: typeof fetch;
};

type GitHubRepository = {
  id?: number;
  permissions?: { pull?: boolean; push?: boolean; admin?: boolean };
};

async function accessibleRepositories(installationId: number, token: string, githubFetch: typeof fetch): Promise<GitHubRepository[]> {
  const repositories: GitHubRepository[] = [];
  for (let page = 1; page <= 100; page += 1) {
    const response = await githubFetch(`https://api.github.com/user/installations/${installationId}/repositories?per_page=100&page=${page}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
    });
    if (response.status === 401) throw Object.assign(new Error("GitHub OAuth session expired"), { status: 401 });
    if (response.status === 403 || response.status === 404) throw Object.assign(new Error("GitHub installation access denied"), { status: response.status });
    if (!response.ok) throw new Error(`GitHub repository authorization failed (${response.status})`);
    const body = await response.json() as { repositories?: GitHubRepository[]; total_count?: number };
    if (!Array.isArray(body.repositories)) throw new Error("GitHub repository authorization response was invalid");
    repositories.push(...body.repositories);
    if (body.repositories.length < 100 || repositories.length >= Number(body.total_count || repositories.length)) return repositories;
  }
  return repositories;
}

export async function authorizeInstallationRepository(token: string, installationId: number, repositoryId: number, githubFetch: typeof fetch): Promise<"authorized" | "forbidden"> {
  if (!Number.isSafeInteger(installationId) || !Number.isSafeInteger(repositoryId) || installationId <= 0 || repositoryId <= 0) return "forbidden";
  const repositories = await accessibleRepositories(installationId, token, githubFetch);
  return repositories.some((repository) => repository.id === repositoryId && repository.permissions?.[REQUIRED_REPOSITORY_PERMISSION] === true) ? "authorized" : "forbidden";
}

export async function authorizeInstallationRepositoryWrite(token: string, installationId: number, repositoryId: number, githubFetch: typeof fetch): Promise<"authorized" | "forbidden"> {
  if (!Number.isSafeInteger(installationId) || !Number.isSafeInteger(repositoryId) || installationId <= 0 || repositoryId <= 0) return "forbidden";
  const repositories = await accessibleRepositories(installationId, token, githubFetch);
  return repositories.some((repository) => repository.id === repositoryId && repository.permissions?.[REQUIRED_REPOSITORY_PERMISSION] === true && repository.permissions?.[REQUIRED_WRITE_PERMISSION] === true) ? "authorized" : "forbidden";
}

export async function authorizeRunAccessWithDependencies(req: Request, runId: string, dependencies: AuthorizationDependencies): Promise<RunAccessResult> {
  const sessionId = sessionIdFromRequest(req);
  if (!sessionId) return { kind: "unauthenticated" };
  if (!dependencies.database || !isUuid(runId)) return { kind: "not_found" };
  const token = await dependencies.sessionToken(sessionId);
  if (!token) return { kind: "unauthenticated" };
  const rows = await dependencies.database.select({ run: scanRuns, githubInstallationId: installations.githubInstallationId, githubRepositoryId: repositories.githubRepositoryId })
    .from(scanRuns).innerJoin(repositories, eq(scanRuns.repositoryId, repositories.id))
    .innerJoin(installations, eq(repositories.installationId, installations.id))
    .where(eq(scanRuns.id, runId)).limit(1);
  const row = rows[0];
  if (!row) return { kind: "not_found" };
  try {
    const authorized = await authorizeInstallationRepository(token, row.githubInstallationId, row.githubRepositoryId, dependencies.githubFetch);
    if (authorized !== "authorized") return { kind: "forbidden" };
  } catch (error) {
    if ((error as { status?: number }).status === 401) return { kind: "unauthenticated" };
    if ((error as { status?: number }).status === 403 || (error as { status?: number }).status === 404) return { kind: "forbidden" };
    throw error;
  }
  return { kind: "authorized", run: row.run, installationId: row.githubInstallationId };
}

export function authorizeRunAccess(req: Request, runId: string): Promise<RunAccessResult> {
  return authorizeRunAccessWithDependencies(req, runId, {
    database: db,
<<<<<<< HEAD
    sessionToken: async (sessionId) => {
      const session = await getRedisClient().get<{ accessToken?: string; expiresAt?: number }>(`warden:oauth:session:${sessionId}`);
      if (!session?.accessToken || !session.expiresAt || session.expiresAt <= Date.now()) return null;
      return session.accessToken;
    },
=======
    sessionToken: (sessionId) => getRedisClient().get<string>(`warden:oauth:session:${sessionId}`),
>>>>>>> origin/main
    githubFetch: fetch,
  });
}
