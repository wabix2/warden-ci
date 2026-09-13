# Warden production operations

## Canonical runtime

Render is the canonical production runtime. `PUBLIC_BASE_URL` must be `https://warden-ci-dvk5.onrender.com` in production. Vercel deployments are preview/development only.

## Health checks

- `/health` verifies the process is live.
- `/ready` verifies required Redis and GitHub App configuration is present.
- A `503` from `/ready` is a deployment/configuration incident, not a scanner verdict.

## Recovery targets

- OAuth/session incident: revoke active sessions and restart the Render service after correcting environment variables.
- Database incident: pause scan ingestion, preserve webhook delivery IDs, restore from the latest Neon backup, then replay only idempotent deliveries.
- Redis incident: OAuth sessions and waitlist/Pro cache operations may fail closed; restore Redis before re-enabling authenticated workflows.

## Data lifecycle

Retain scan runs and findings only for the customer-configured retention period. Audit events and remediation state must be retained for the active compliance period. Add indexes before enabling high-volume tenants, and test migrations on a non-production database first.

## Incident checklist

1. Record the request ID, deployment commit, and affected endpoint.
2. Check `/health`, `/ready`, Render logs, Neon health, and Upstash health.
3. Do not disable authorization or security gates to restore availability.
4. Preserve failed webhook delivery IDs and replay only after the root cause is fixed.
5. Document impact, remediation, and verification evidence.
