"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isUuid = isUuid;
exports.authorizeRunAccessWithDependencies = authorizeRunAccessWithDependencies;
exports.authorizeRunAccess = authorizeRunAccess;
const drizzle_orm_1 = require("drizzle-orm");
const db_1 = require("../db");
const schema_1 = require("../db/schema");
const redis_1 = require("../lib/redis");
function sessionIdFromRequest(req) {
    const cookie = req.headers.cookie ?? "";
    return cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith("warden_session="))?.slice("warden_session=".length);
}
function isUuid(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
async function authorizeRunAccessWithDependencies(req, runId, dependencies) {
    const sessionId = sessionIdFromRequest(req);
    if (!sessionId)
        return { kind: "unauthenticated" };
    if (!dependencies.database || !isUuid(runId))
        return { kind: "not_found" };
    const token = await dependencies.sessionToken(sessionId);
    if (!token)
        return { kind: "unauthenticated" };
    const rows = await dependencies.database.select({ run: schema_1.scanRuns, githubInstallationId: schema_1.installations.githubInstallationId })
        .from(schema_1.scanRuns).innerJoin(schema_1.repositories, (0, drizzle_orm_1.eq)(schema_1.scanRuns.repositoryId, schema_1.repositories.id))
        .innerJoin(schema_1.installations, (0, drizzle_orm_1.eq)(schema_1.repositories.installationId, schema_1.installations.id))
        .where((0, drizzle_orm_1.eq)(schema_1.scanRuns.id, runId)).limit(1);
    const row = rows[0];
    if (!row)
        return { kind: "not_found" };
    const response = await dependencies.githubFetch(`https://api.github.com/user/installations/${row.githubInstallationId}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
    });
    if (response.status === 401)
        return { kind: "unauthenticated" };
    if (response.status === 403 || response.status === 404)
        return { kind: "forbidden" };
    if (!response.ok)
        throw new Error(`GitHub installation authorization failed (${response.status})`);
    return { kind: "authorized", run: row.run, installationId: row.githubInstallationId };
}
function authorizeRunAccess(req, runId) {
    return authorizeRunAccessWithDependencies(req, runId, {
        database: db_1.db,
        sessionToken: (sessionId) => (0, redis_1.getRedisClient)().get(`warden:oauth:session:${sessionId}`),
        githubFetch: fetch,
    });
}
