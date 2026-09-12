-- Required before enabling authenticated run reports.
-- Existing deployments must backfill repository and installation ownership before
-- accepting report requests; the application fails closed when a run cannot join
-- through warden_repositories -> warden_installations.
--
-- This migration documents the ownership contract. The tables already exist in
-- the current schema; webhook ingestion now upserts both records before a run.
-- Operators with legacy rows must repair rows whose repository_id is not a real
-- warden_repositories.id before exposing /api/runs/:runId.

CREATE INDEX IF NOT EXISTS warden_scan_runs_repository_id_idx
  ON warden_scan_runs (repository_id);
CREATE INDEX IF NOT EXISTS warden_repositories_installation_id_idx
  ON warden_repositories (installation_id);
