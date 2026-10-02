-- Warden CI: full schema for an EMPTY Postgres (Neon) database.
-- Built from src/db/schema.ts as summarized by v0, plus the indexes and
-- foreign keys from migrations 0002-0006. Safe to re-run.
-- Compare against src/db/schema.ts before relying on it.
-- Do NOT add the ownership foreign keys here: run `pnpm db:ownership:apply` for those.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS warden_installations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  github_installation_id integer NOT NULL UNIQUE,
  account_login text NOT NULL,
  account_type text NOT NULL,
  plan text NOT NULL DEFAULT 'free',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS warden_repositories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_id uuid NOT NULL,
  github_repository_id integer NOT NULL UNIQUE,
  full_name text NOT NULL,
  default_branch text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS warden_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_id uuid NOT NULL UNIQUE,
  mode text NOT NULL DEFAULT 'block',
  minimum_severity text NOT NULL DEFAULT 'high',
  block_secrets boolean NOT NULL DEFAULT true,
  block_malicious_packages boolean NOT NULL DEFAULT true,
  block_dangerous_exec boolean NOT NULL DEFAULT true,
  require_clean_baseline boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS warden_entitlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_id uuid NOT NULL,
  provider text NOT NULL DEFAULT 'gumroad',
  provider_reference text NOT NULL UNIQUE,
  plan text NOT NULL,
  status text NOT NULL,
  current_period_end timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS warden_github_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id text NOT NULL UNIQUE,
  event text NOT NULL,
  installation_id integer,
  repository_id integer,
  occurred_at timestamptz,
  fingerprint text NOT NULL,
  status text NOT NULL DEFAULT 'received',
  attempt integer NOT NULL DEFAULT 0,
  error text,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS warden_scan_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  repository_id uuid NOT NULL,
  github_delivery_id text UNIQUE,
  pull_request_number integer,
  commit_sha text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  verdict text,
  findings_count integer NOT NULL DEFAULT 0,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS warden_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_run_id uuid NOT NULL,
  fingerprint text NOT NULL,
  severity text NOT NULL,
  category text NOT NULL,
  title text NOT NULL,
  message text NOT NULL,
  file_path text,
  line_number integer,
  remediation text,
  package_name text,
  ecosystem text,
  manifest_path text,
  advisory_id text,
  affected_range text,
  current_version text,
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT warden_findings_scan_run_id_fingerprint_unique UNIQUE (scan_run_id, fingerprint)
);

CREATE TABLE IF NOT EXISTS warden_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_id uuid NOT NULL,
  actor text NOT NULL,
  event_type text NOT NULL,
  target text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS warden_policy_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_id uuid NOT NULL,
  version integer NOT NULL,
  policy jsonb NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT warden_policy_versions_installation_id_version_unique UNIQUE (installation_id, version)
);

CREATE TABLE IF NOT EXISTS warden_suppressions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_id uuid NOT NULL,
  fingerprint text NOT NULL,
  reason text NOT NULL,
  expires_at timestamptz,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT warden_suppressions_installation_id_fingerprint_unique UNIQUE (installation_id, fingerprint)
);

CREATE TABLE IF NOT EXISTS warden_remediations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  finding_id uuid NOT NULL,
  installation_id uuid NOT NULL,
  repository_id uuid NOT NULL,
  package_name text NOT NULL,
  target_version text NOT NULL,
  status text NOT NULL DEFAULT 'requested',
  branch_name text,
  pull_request_number integer,
  pull_request_url text,
  verification_status text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT warden_remediations_installation_id_repository_id_finding_id_target_version_unique
    UNIQUE (installation_id, repository_id, finding_id, target_version)
);

-- Indexes (migrations 0002, 0003, 0005, 0006)
CREATE INDEX IF NOT EXISTS warden_scan_runs_repository_id_idx ON warden_scan_runs (repository_id);
CREATE INDEX IF NOT EXISTS warden_repositories_installation_id_idx ON warden_repositories (installation_id);
CREATE INDEX IF NOT EXISTS warden_remediations_finding_idx ON warden_remediations (finding_id);
CREATE INDEX IF NOT EXISTS warden_policy_versions_installation_idx ON warden_policy_versions (installation_id);
CREATE INDEX IF NOT EXISTS warden_suppressions_installation_idx ON warden_suppressions (installation_id);
CREATE INDEX IF NOT EXISTS warden_github_webhook_events_status_idx ON warden_github_webhook_events (status, updated_at);

-- Foreign keys (migrations 0003, 0005), added only if missing
DO $$
DECLARE
  fk record;
BEGIN
  FOR fk IN
    SELECT * FROM (VALUES
      ('warden_remediations', 'warden_remediations_finding_id_fkey',
        'FOREIGN KEY (finding_id) REFERENCES warden_findings(id)'),
      ('warden_remediations', 'warden_remediations_installation_id_fkey',
        'FOREIGN KEY (installation_id) REFERENCES warden_installations(id)'),
      ('warden_remediations', 'warden_remediations_repository_id_fkey',
        'FOREIGN KEY (repository_id) REFERENCES warden_repositories(id)'),
      ('warden_policies', 'warden_policies_installation_id_fkey',
        'FOREIGN KEY (installation_id) REFERENCES warden_installations(id)'),
      ('warden_policy_versions', 'warden_policy_versions_installation_id_fkey',
        'FOREIGN KEY (installation_id) REFERENCES warden_installations(id)'),
      ('warden_suppressions', 'warden_suppressions_installation_id_fkey',
        'FOREIGN KEY (installation_id) REFERENCES warden_installations(id)')
    ) AS t(tbl, name, ddl)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = fk.name) THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I %s', fk.tbl, fk.name, fk.ddl);
    END IF;
  END LOOP;
END $$;

