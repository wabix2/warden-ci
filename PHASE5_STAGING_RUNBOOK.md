# Phase 5 staging runbook

Status: BLOCKED until a controlled staging URL, database, GitHub App, and isolated tenant identities are supplied.

## Prerequisites

- Node.js and pnpm
- Vercel staging project or equivalent HTTPS deployment
- isolated `TENANT_A`/`TENANT_B` identities
- GitHub App staging credentials and webhook secret
- PostgreSQL `DATABASE_URL` with migrations applied
- Redis URL if the deployment uses Redis
- optional payment-provider sandbox credentials

## Deployment

1. Apply `migrations/0006_github_webhook_events.sql` to the staging database.
2. Configure `GITHUB_WEBHOOK_SECRET`, `DATABASE_URL`, Redis, GitHub App settings, and provider sandbox values in the deployment environment.
3. Deploy the current commit to a non-production staging target.
4. Configure the GitHub App webhook to `POST /api/github/webhooks`.
5. Record the deployment URL in `STAGING_BASE_URL` locally; never commit it if private.

## Tests

```bash
STAGING_BASE_URL=https://controlled-staging.example \
TENANT_A_TOKEN=... TENANT_B_TOKEN=... \
TENANT_A_REPOSITORY_ID=... TENANT_B_REPOSITORY_ID=... \
TENANT_A_INSTALLATION_ID=... TENANT_B_INSTALLATION_ID=... \
pnpm test:staging-idor
```

Execute duplicate, replay, crash/retry, uninstall/reinstall, tenant-binding, cache, async, and billing scenarios from `PHASE4_STAGING_RUNBOOK.md` and `PHASE5_EVIDENCE_MATRIX.md`.

## Teardown

Disable the staging GitHub App, delete controlled repositories and installations, revoke test tokens, remove provider sandbox objects, and destroy the staging database/cache. Do not use production resources.
