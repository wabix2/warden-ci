# Phase 4 Controlled Staging Runbook

## Required controlled resources

Create only dedicated staging resources:

- `TENANT_A` / `USER_A` / `INSTALLATION_A` / `REPO_A` / `SUBSCRIPTION_A`
- `TENANT_B` / `USER_B` / `INSTALLATION_B` / `REPO_B` / `SUBSCRIPTION_B`

Use an isolated staging database and Redis namespace. Do not reuse production users, repositories, organizations, payment records, or webhook secrets.

## Environment inputs

Set these only in the deployment/test environment, never in git:

- `WARDEN_STAGING_URL`
- `WARDEN_STAGING_TOKEN_A`
- `WARDEN_STAGING_TOKEN_B`
- `WARDEN_STAGING_IDOR_CASES`
- GitHub App staging credentials and webhook secret
- provider sandbox webhook credentials, if available

The IDOR runner exits `BLOCKED` when required inputs are absent; it never substitutes local fixtures for deployed evidence.

## Deployment sequence

1. Deploy a staging branch to a dedicated Vercel preview/project.
2. Attach isolated database and Redis resources.
3. Configure GitHub App staging credentials and a staging webhook URL.
4. Create the two controlled tenant/resource graphs.
5. Run positive A->A and B->B requests.
6. Run all identifier substitution, deletion, stale-session, and cross-tenant requests.
7. Replay and reorder webhook deliveries using recorded staging payloads.
8. Run billing sandbox events, if provider credentials are available.
9. Inspect response bodies, headers, logs, and cache behavior for cross-tenant data.
10. Tear down staging resources and revoke test credentials.

## Safety requirements

- Never print tokens, private keys, payment secrets, raw webhook credentials, or source code.
- Use synthetic tenant names and a dedicated test organization.
- Redact installation IDs and billing identifiers in published reports where they could identify controlled resources.
- Preserve request IDs, delivery IDs, and assertion output as evidence without secrets.

## Current status

The repository contains local deterministic harnesses and a fail-closed staging runner. A deployed two-tenant staging URL and controlled credentials are not available in this environment, so deployed isolation is currently `BLOCKED`/`UNVERIFIED`.
