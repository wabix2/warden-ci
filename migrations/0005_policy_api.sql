-- Policy CRUD API storage. These tables are declared in src/db/schema.ts and are
-- read/written by the /api/policy* routes. Guarded with IF NOT EXISTS so this is safe
-- to apply on deployments where they were already created via an earlier push.

CREATE TABLE IF NOT EXISTS warden_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_id uuid NOT NULL UNIQUE REFERENCES warden_installations(id),
  mode text NOT NULL DEFAULT 'block',
  minimum_severity text NOT NULL DEFAULT 'high',
  block_secrets boolean NOT NULL DEFAULT true,
  block_malicious_packages boolean NOT NULL DEFAULT true,
  block_dangerous_exec boolean NOT NULL DEFAULT true,
  require_clean_baseline boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS warden_policy_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_id uuid NOT NULL REFERENCES warden_installations(id),
  version integer NOT NULL,
  policy jsonb NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT warden_policy_versions_unique UNIQUE (installation_id, version)
);
CREATE INDEX IF NOT EXISTS warden_policy_versions_installation_idx ON warden_policy_versions (installation_id);

CREATE TABLE IF NOT EXISTS warden_suppressions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_id uuid NOT NULL REFERENCES warden_installations(id),
  fingerprint text NOT NULL,
  reason text NOT NULL,
  expires_at timestamptz,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT warden_suppressions_unique UNIQUE (installation_id, fingerprint)
);
CREATE INDEX IF NOT EXISTS warden_suppressions_installation_idx ON warden_suppressions (installation_id);
