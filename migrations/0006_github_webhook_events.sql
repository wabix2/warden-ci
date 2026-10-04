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
CREATE INDEX IF NOT EXISTS warden_github_webhook_events_status_idx ON warden_github_webhook_events(status, updated_at);
