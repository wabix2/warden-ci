"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.REQUIRED_REPOSITORY_PERMISSION = void 0;
exports.isUuid = isUuid;
exports.authorizeInstallationRepository = authorizeInstallationRepository;
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
exports.REQUIRED_REPOSITORY_PERMISSION = "pull";
async function accessibleRepositories(installationId, token, githubFetch) {
    const repositories = [];
    for (let page = 1; page <= 100; page += 1) {
        const response = await githubFetch(`https://api.github.com/user/installations/${installationId}/repositories?per_page=100&page=${page}`, {
            headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
        });
        if (response.status === 401)
            throw Object.assign(new Error("GitHub OAuth session expired"), { status: 401 });
        if (response.status === 403 || response.status === 404)
            throw Object.assign(new Error("GitHub installation access denied"), { status: response.status });
        if (!response.ok)
            throw new Error(`GitHub repository authorization failed (${response.status})`);
        const body = await response.json();
        if (!Array.isArray(body.repositories))
            throw new Error("GitHub repository authorization response was invalid");
        repositories.push(...body.repositories);
        if (body.repositories.length < 100 || repositories.length >= Number(body.total_count || repositories.length))
            return repositories;
    }
    return repositories;
}
async function authorizeInstallationRepository(token, installationId, repositoryId, githubFetch) {
    if (!Number.isSafeInteger(installationId) || !Number.isSafeInteger(repositoryId) || installationId <= 0 || repositoryId <= 0)
        return "forbidden";
    const repositories = await accessibleRepositories(installationId, token, githubFetch);
    return repositories.some((repository) => repository.id === repositoryId && repository.permissions?.[exports.REQUIRED_REPOSITORY_PERMISSION] === true) ? "authorized" : "forbidden";
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
    const rows = await dependencies.database.select({ run: schema_1.scanRuns, githubInstallationId: schema_1.installations.githubInstallationId, githubRepositoryId: schema_1.repositories.githubRepositoryId })
        .from(schema_1.scanRuns).innerJoin(schema_1.repositories, (0, drizzle_orm_1.eq)(schema_1.scanRuns.repositoryId, schema_1.repositories.id))
        .innerJoin(schema_1.installations, (0, drizzle_orm_1.eq)(schema_1.repositories.installationId, schema_1.installations.id))
        .where((0, drizzle_orm_1.eq)(schema_1.scanRuns.id, runId)).limit(1);
    const row = rows[0];
    if (!row)
        return { kind: "not_found" };
    try {
        const authorized = await authorizeInstallationRepository(token, row.githubInstallationId, row.githubRepositoryId, dependencies.githubFetch);
        if (authorized !== "authorized")
            return { kind: "forbidden" };
    }
    catch (error) {
        if (error.status === 401)
            return { kind: "unauthenticated" };
        if (error.status === 403 || error.status === 404)
            return { kind: "forbidden" };
        throw error;
    }
    return { kind: "authorized", run: row.run, installationId: row.githubInstallationId };
}
function authorizeRunAccess(req, runId) {
    return authorizeRunAccessWithDependencies(req, runId, {
        database: db_1.db,
        sessionToken: (sessionId) => (0, redis_1.getRedisClient)().get(`warden:oauth:session:${sessionId}`),
        githubFetch: fetch,
    });
}
