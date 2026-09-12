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

function sessionIdFromRequest(req: Request): string | undefined {
  const cookie = req.headers.cookie ?? "";
  return cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith("warden_session="))?.slice("warden_session=".length);
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

type AuthorizationDependencies = {
  database: any;
  sessionToken: (sessionId: string) => Promise<string | null>;
  githubFetch: typeof fetch;
};

export async function authorizeRunAccessWithDependencies(req: Request, runId: string, dependencies: AuthorizationDependencies): Promise<RunAccessResult> {
  const sessionId = sessionIdFromRequest(req);
  if (!sessionId) return { kind: "unauthenticated" };
  if (!dependencies.database || !isUuid(runId)) return { kind: "not_found" };
  const token = await dependencies.sessionToken(sessionId);
  if (!token) return { kind: "unauthenticated" };
  const rows = await dependencies.database.select({ run: scanRuns, githubInstallationId: installations.githubInstallationId })
    .from(scanRuns).innerJoin(repositories, eq(scanRuns.repositoryId, repositories.id))
    .innerJoin(installations, eq(repositories.installationId, installations.id))
    .where(eq(scanRuns.id, runId)).limit(1);
  const row = rows[0];
  if (!row) return { kind: "not_found" };
  const response = await dependencies.githubFetch(`https://api.github.com/user/installations/${row.githubInstallationId}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
  });
  if (response.status === 401) return { kind: "unauthenticated" };
  if (response.status === 403 || response.status === 404) return { kind: "forbidden" };
  if (!response.ok) throw new Error(`GitHub installation authorization failed (${response.status})`);
  return { kind: "authorized", run: row.run, installationId: row.githubInstallationId };
}

export function authorizeRunAccess(req: Request, runId: string): Promise<RunAccessResult> {
  return authorizeRunAccessWithDependencies(req, runId, {
    database: db,
    sessionToken: (sessionId) => getRedisClient().get<string>(`warden:oauth:session:${sessionId}`),
    githubFetch: fetch,
  });
}
