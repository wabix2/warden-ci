ALTER TABLE warden_findings ADD COLUMN IF NOT EXISTS package_name text;
ALTER TABLE warden_findings ADD COLUMN IF NOT EXISTS ecosystem text;
ALTER TABLE warden_findings ADD COLUMN IF NOT EXISTS manifest_path text;
ALTER TABLE warden_findings ADD COLUMN IF NOT EXISTS advisory_id text;
ALTER TABLE warden_findings ADD COLUMN IF NOT EXISTS affected_range text;
ALTER TABLE warden_findings ADD COLUMN IF NOT EXISTS current_version text;
