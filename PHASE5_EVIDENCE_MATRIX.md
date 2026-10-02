# Phase 5 evidence matrix

| Capability | Local | Integration | Staging | External | Status | Evidence |
|---|---|---|---|---|---|---|
| Durable pre-ack webhook claim | VERIFIED LOCALLY | PARTIAL | BLOCKED | n/a | VERIFIED LOCALLY / BLOCKED STAGING | `PHASE5_TRUST_BOUNDARY_MAP.md`, `src/github/webhookHandler.ts`, `src/github/webhookStore.ts` |
| Duplicate delivery idempotency | VERIFIED LOCALLY | PARTIAL | BLOCKED | n/a | PARTIALLY VERIFIED | `scripts/test-webhook-durable-boundary.mjs` |
| Crash/retry recovery | VERIFIED LOCALLY | PARTIAL | BLOCKED | n/a | PARTIALLY VERIFIED | durable boundary test |
| Server-derived installation/repository binding | IMPLEMENTED | NOT RUN | BLOCKED | n/a | UNVERIFIED | `PHASE4_TRUST_BOUNDARY_MAP.md` |
| Two-tenant deployed HTTP isolation | harness ready | helper tests | BLOCKED | n/a | BLOCKED | `scripts/test-staging-idor.mjs` |
| Provider billing sandbox | deterministic fixtures | NOT RUN | BLOCKED | n/a | UNVERIFIED | `scripts/test-billing-boundaries.mjs` |
| GitHub install lifecycle | helper tests | NOT RUN | BLOCKED | n/a | UNVERIFIED | `PHASE5_STAGING_RUNBOOK.md` |
| Cache/async staging isolation | local key tests | NOT RUN | BLOCKED | n/a | UNVERIFIED | Phase 4 harness |
| VSIX packaging | VERIFIED | n/a | n/a | clean VS Code unavailable | PARTIALLY VERIFIED | `EXTERNAL_VSCODE_TEST_PLAN.md` |

## Blocking inputs

No controlled staging URL, tenant credentials, GitHub App staging installation, database instance, Redis instance, or provider sandbox credentials were available in this environment. No staging claim is made.
