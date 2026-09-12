"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.emptyBackfillReport = emptyBackfillReport;
exports.inspectOwnership = inspectOwnership;
exports.hasIntegrityErrors = hasIntegrityErrors;
exports.assertSafeToApply = assertSafeToApply;
exports.applyOwnershipConstraints = applyOwnershipConstraints;
exports.formatBackfillReport = formatBackfillReport;
function emptyBackfillReport() {
    return {
        legacyRunsFound: 0,
        ownershipAlreadyPresent: 0,
        ownershipConfirmed: 0,
        ownershipUnresolved: 0,
        skipped: 0,
        errors: 0,
        recordsWouldChange: 0,
        recordsChanged: 0,
        integrity: {
            orphanedRuns: 0,
            orphanedRepositories: 0,
            missingInstallations: 0,
            conflictingRepositories: 0,
            duplicateInstallations: 0,
            invalidForeignKeys: 0,
        },
    };
}
async function count(client, sql) {
    const result = await client.query(sql);
    return Number(result.rows[0]?.count || 0);
}
async function inspectOwnership(client) {
    const report = emptyBackfillReport();
    report.legacyRunsFound = await count(client, "SELECT count(*) FROM warden_scan_runs");
    report.ownershipAlreadyPresent = await count(client, `
    SELECT count(*) FROM warden_scan_runs r
    JOIN warden_repositories repo ON repo.id = r.repository_id
    JOIN warden_installations i ON i.id = repo.installation_id`);
    report.ownershipConfirmed = report.ownershipAlreadyPresent;
    report.ownershipUnresolved = report.legacyRunsFound - report.ownershipAlreadyPresent;
    report.skipped = report.ownershipUnresolved;
    report.integrity.orphanedRuns = await count(client, `
    SELECT count(*) FROM warden_scan_runs r
    LEFT JOIN warden_repositories repo ON repo.id = r.repository_id
    WHERE repo.id IS NULL`);
    report.integrity.orphanedRepositories = await count(client, `
    SELECT count(*) FROM warden_repositories repo
    LEFT JOIN warden_installations i ON i.id = repo.installation_id
    WHERE i.id IS NULL`);
    report.integrity.missingInstallations = report.integrity.orphanedRepositories;
    report.integrity.conflictingRepositories = await count(client, `
    SELECT count(*) FROM warden_repositories
    GROUP BY github_repository_id
    HAVING count(DISTINCT installation_id) > 1`);
    report.integrity.duplicateInstallations = await count(client, `
    SELECT count(*) FROM (
      SELECT github_installation_id FROM warden_installations
      GROUP BY github_installation_id HAVING count(*) > 1
    ) duplicates`);
    report.integrity.invalidForeignKeys = report.integrity.orphanedRuns + report.integrity.orphanedRepositories;
    return report;
}
function hasIntegrityErrors(report) {
    return Object.values(report.integrity).some((value) => value > 0) || report.errors > 0;
}
function assertSafeToApply(report) {
    if (hasIntegrityErrors(report))
        throw new Error("Ownership integrity checks failed; refusing to apply constraints");
    if (report.ownershipUnresolved > 0)
        throw new Error("Unresolved run ownership exists; refusing to apply constraints");
}
async function applyOwnershipConstraints(client) {
    await client.query(`
    DO $$ BEGIN
      ALTER TABLE warden_repositories
        ADD CONSTRAINT warden_repositories_installation_fk
        FOREIGN KEY (installation_id) REFERENCES warden_installations(id);
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  `);
    await client.query(`
    DO $$ BEGIN
      ALTER TABLE warden_scan_runs
        ADD CONSTRAINT warden_scan_runs_repository_fk
        FOREIGN KEY (repository_id) REFERENCES warden_repositories(id);
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  `);
}
function formatBackfillReport(report) {
    return JSON.stringify(report, null, 2);
}
