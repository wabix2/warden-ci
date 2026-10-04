# Phase 3 forensic audit

| Capability | Implementation | Existing proof | Missing proof | Status |
|---|---|---|---|---|
| Shared scan engine | `src/scan/index.ts` | build, package-risk, benchmark suites | deployed API integration | TESTED |
| Registry providers | `src/scan/ecosystems/*` | recorded metadata and outage tests | live multi-registry corpus | PARTIALLY VERIFIED |
| Package identity | `src/scan/ecosystems/identity.ts` | identity unit tests | complete provider threading | PARTIALLY VERIFIED |
| Policy | `src/enforcement/policy.ts` | policy suite | deployed policy isolation | TESTED / UNVERIFIED DEPLOYMENT |
| OAuth sessions | `src/auth/runAccess.ts`, `src/server.ts` | authorization suite | deployed expired/revoked-session HTTP tests | TESTED / UNVERIFIED DEPLOYMENT |
| GitHub installation ownership | `dashboardInstallation`, run authorization | isolated dependency tests | real installation lifecycle | PARTIALLY VERIFIED |
| Webhooks | `src/github/webhookHandler.ts` | signature harness | production lifecycle/idempotency; active executor is deferred | PARTIALLY VERIFIED |
| Billing | `src/billing/store.ts`, Gumroad handlers | local billing suite | provider sandbox and replay verification | PARTIALLY VERIFIED |
| IDE | `ide-extension/src/*` | compile, unit tests, VSIX packaging | clean external VS Code install | TESTED / UNVERIFIED EXTERNAL |
| Benchmarks | `benchmarks/*`, `scripts/evaluate-package-risk.mjs` | synthetic 10-fixture and regression 6-fixture runs | externally sourced corpus | TESTED SYNTHETIC |
| Privacy | `PRIVACY.md`, extension client | package-level request design | deployed traffic inspection | DOCUMENTED / UNVERIFIED |

## Highest-risk assumptions

1. The active webhook route validates signatures but returns before scan execution; GitHub Actions is the stated canonical gate.
2. Dashboard ownership is derived from GitHub login and database installation mapping; deployed cross-tenant HTTP evidence is absent.
3. Billing authority is Redis-backed and owner-login keyed; provider-backed lifecycle verification is absent.
4. Synthetic benchmark labels are deterministic fixtures, not real-world performance evidence.
5. VSIX packaging is reproducible, but no clean external VS Code installation has been observed in this environment.
