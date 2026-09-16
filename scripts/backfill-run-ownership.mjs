import pg from "pg";

const { Pool } = pg;
const apply = process.argv.includes("--apply");
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error("DATABASE_URL is required; no database was contacted.");
  process.exit(2);
}

const pool = new Pool({ connectionString: databaseUrl, max: 1, ssl: { rejectUnauthorized: false } });
const client = await pool.connect();
const count = async (sql) => Number((await client.query(sql)).rows[0]?.count || 0);
const report = {
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

try {
  report.legacyRunsFound = await count("SELECT count(*) FROM warden_scan_runs");
  report.ownershipAlreadyPresent = await count(`SELECT count(*) FROM warden_scan_runs r JOIN warden_repositories repo ON repo.id = r.repository_id JOIN warden_installations i ON i.id = repo.installation_id`);
  report.ownershipConfirmed = report.ownershipAlreadyPresent;
  report.ownershipUnresolved = report.legacyRunsFound - report.ownershipAlreadyPresent;
  report.skipped = report.ownershipUnresolved;
  report.integrity.orphanedRuns = await count("SELECT count(*) FROM warden_scan_runs r LEFT JOIN warden_repositories repo ON repo.id = r.repository_id WHERE repo.id IS NULL");
  report.integrity.orphanedRepositories = await count("SELECT count(*) FROM warden_repositories repo LEFT JOIN warden_installations i ON i.id = repo.installation_id WHERE i.id IS NULL");
  report.integrity.missingInstallations = report.integrity.orphanedRepositories;
  report.integrity.conflictingRepositories = await count("SELECT count(*) FROM (SELECT github_repository_id FROM warden_repositories GROUP BY github_repository_id HAVING count(DISTINCT installation_id) > 1) conflicts");
  report.integrity.duplicateInstallations = await count("SELECT count(*) FROM (SELECT github_installation_id FROM warden_installations GROUP BY github_installation_id HAVING count(*) > 1) duplicates");
  report.integrity.invalidForeignKeys = report.integrity.orphanedRuns + report.integrity.orphanedRepositories;

  console.log(JSON.stringify(report, null, 2));
  if (!apply) {
    console.log("Dry run only. No ownership was assigned and no schema was changed.");
    process.exitCode = report.ownershipUnresolved || report.integrity.invalidForeignKeys ? 1 : 0;
  } else if (report.ownershipUnresolved || Object.values(report.integrity).some((value) => value > 0)) {
    throw new Error("Ownership is unresolved or integrity checks failed; refusing to apply constraints");
  } else {
    await client.query("BEGIN");
    await client.query(`DO $$ BEGIN ALTER TABLE warden_repositories ADD CONSTRAINT warden_repositories_installation_fk FOREIGN KEY (installation_id) REFERENCES warden_installations(id); EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
    await client.query(`DO $$ BEGIN ALTER TABLE warden_scan_runs ADD CONSTRAINT warden_scan_runs_repository_fk FOREIGN KEY (repository_id) REFERENCES warden_repositories(id); EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
    await client.query("COMMIT");
    console.log("Ownership constraints applied transactionally. recordsChanged=0; no historical ownership was guessed.");
  }
} catch (error) {
  report.errors += 1;
  try { await client.query("ROLLBACK"); } catch {}
  console.error(error instanceof Error ? error.message : "Ownership backfill failed");
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
