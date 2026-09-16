# Phase 4 Completion Report

## 1. Executive summary

Phase 4 created the controlled-staging evidence boundary and strengthened local trust-boundary testing. It adds a complete request/authorization map, fail-closed staging IDOR runner, webhook claim/process/mark state model, billing tenant-binding tests, cache/async identity tests, security decision logging, staging runbook, and external VS Code test plan.

A real two-tenant staging deployment was not available in this environment. Therefore deployed tenant isolation, provider-backed billing, active webhook lifecycle, and external VS Code installation remain `BLOCKED` or `UNVERIFIED`; they are not claimed as passed.

## 2. Environment

- Local TypeScript/Node test environment: available and used.
- Vercel staging URL/domain: not provided.
- Isolated staging database/Redis: not provided.
- GitHub App staging identities/installations: not provided.
- Payment-provider sandbox: not provided.
- Clean VS Code executable: not available in repository evidence.

No credentials or secrets were committed.

## 3. Trust boundary map

`PHASE4_TRUST_BOUNDARY_MAP.md` maps health, package check, runs/findings, dashboard, policy, audit, billing, GitHub webhook, Gumroad webhook, and automation surfaces. It records authentication, principal, owner resolution, client-controlled identifiers, authorization evidence, and risk.

## 4. Multi-tenant results

| Attack | Expected | Actual | Status |
|---|---|---|---|
| A -> A controlled resource | allow | local harness model allows | TESTED LOCALLY |
| B -> B controlled resource | allow | local harness model allows | TESTED LOCALLY |
| A -> B resource ID | deny | staging runner BLOCKED without deployment | UNVERIFIED |
| B -> A resource ID | deny | staging runner BLOCKED without deployment | UNVERIFIED |
| cache key A -> B | no data | tenant-bound key test passes | TESTED LOCALLY |
| async job A controlled by B | deny | job identity-binding test passes | TESTED LOCALLY |
| subscription A -> tenant B | deny | billing boundary test passes | TESTED LOCALLY |

No successful deployed attack was observed because no controlled staging deployment was available. This is not evidence that deployed isolation passes.

## 5. IDOR/BOLA results

The fail-closed `scripts/test-staging-idor.mjs` runner supports GET/POST/PUT/PATCH/DELETE cases and checks both denial status and forbidden response markers. It exits `BLOCKED` rather than using mocks when `WARDEN_STAGING_URL`, tenant credentials, or case definitions are absent.

Deployed ID substitution for tenant, installation, repository, run, audit, policy, and subscription identifiers: `UNVERIFIED`.

## 6. GitHub lifecycle

Local review confirms run authorization uses repository/install relationships plus authenticated GitHub access checks. Real install, repository removal, uninstall, reinstall, revocation, organization change, and repository transfer lifecycle tests require controlled GitHub App staging resources and remain `UNVERIFIED`.

## 7. Webhook lifecycle

- Raw signature checks: VERIFIED locally.
- Duplicate/replay claim model: VERIFIED locally through `src/github/webhookLifecycle.ts` tests.
- Failure recording/retry state: VERIFIED locally.
- Active route durable processing: NOT VERIFIED.
- Production ordering and deferred execution: UNVERIFIED.

The active pull-request handler acknowledges actionable events before the historical executor and currently does not wire the durable processor. This is documented as an architectural gap rather than treated as safe by assumption.

## 8. Billing

- Server-side entitlement boundary: VERIFIED locally.
- Client-supplied plan cannot grant access in the boundary model: VERIFIED locally.
- Cross-tenant subscription identifiers are denied in the boundary model: VERIFIED locally.
- Provider signature tests: VERIFIED locally.
- Provider sandbox subscription lifecycle: UNVERIFIED/BLOCKED.
- Real duplicate/replay/cancellation/renewal/account-mismatch events: UNVERIFIED.

## 9. Cache and async isolation

Tenant-bound cache-key and async-job identity tests pass locally. They assert tenant, principal, installation, repository, event, and job identifiers are retained. Deployed cache/job infrastructure isolation remains `UNVERIFIED`.

## 10. VS Code

- Local compilation: VERIFIED.
- Local extension tests: VERIFIED.
- VSIX packaging and inspection: VERIFIED.
- External clean install and workspace lifecycle: UNVERIFIED.
- Exact external procedure: `EXTERNAL_VSCODE_TEST_PLAN.md`.

## 11. Security findings

- SF-001: deployed tenant isolation is not proven; controlled staging test blocked. No false pass reported.
- SF-002: active webhook route acknowledges before durable processing; state-machine abstraction and regression test added, but route wiring remains required.
- SF-003: billing owner-login design is not tenant-first; local cross-tenant boundary model added, provider-backed tenant binding remains unverified.

## 12. Remaining gaps

Critical: controlled two-tenant deployment, durable webhook route integration, provider-backed billing tenant binding.

High: GitHub installation lifecycle, external VS Code install, full cache/async deployment validation.

Medium: externally sourced package corpus and production traffic/retention inspection.

## 13. Evidence matrix

| Capability | Local | Integration | Staging | External | Status |
|---|---|---|---|---|---|
| Scan/verdict engine | verified | verified | n/a | n/a | VERIFIED LOCALLY |
| IDOR/BOLA | harness | helper tests | blocked | n/a | UNVERIFIED DEPLOYED |
| Webhook signatures | verified | verified | blocked | n/a | PARTIALLY VERIFIED |
| Webhook lifecycle | state model | local tests | blocked | n/a | UNVERIFIED |
| Billing authority | verified | adapter tests | blocked | n/a | PARTIALLY VERIFIED |
| Cache/async boundaries | verified model | n/a | blocked | n/a | PARTIALLY VERIFIED |
| VSIX | verified | n/a | n/a | blocked | PARTIALLY VERIFIED |

## 14. Production claims not justified

Warden is not justified in claiming production-ready, enterprise-ready, secure, multi-tenant, payment-verified, webhook-production-safe, marketplace-ready, externally installable, or highly accurate based on this phase’s evidence.

## 15. Next milestone

Deploy a controlled two-tenant staging environment and wire the durable webhook processor so HTTP authorization, GitHub lifecycle, webhook idempotency/order/retry, cache/async scope, and provider-backed entitlement can be tested end to end.
