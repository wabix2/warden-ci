CREATE TABLE IF NOT EXISTS warden_remediations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  finding_id uuid NOT NULL REFERENCES warden_findings(id),
  installation_id uuid NOT NULL REFERENCES warden_installations(id),
  repository_id uuid NOT NULL REFERENCES warden_repositories(id),
  package_name text NOT NULL,
  target_version text NOT NULL,
  status text NOT NULL DEFAULT 'requested',
  branch_name text,
  pull_request_number integer,
  pull_request_url text,
  verification_status text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT warden_remediations_target_unique UNIQUE (installation_id, repository_id, finding_id, target_version)
);
CREATE INDEX IF NOT EXISTS warden_remediations_finding_idx ON warden_remediations (finding_id);
