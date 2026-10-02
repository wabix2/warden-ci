# Phase 4 Security Findings

## Findings

### SF-001 — deployed tenant isolation
- Severity: critical until proven
- Attack: replace a client-controlled resource/installation/tenant identifier with the other staging tenant's identifier.
- Impact: potential BOLA/IDOR and cross-tenant data/state access.
- Current status: no deployed staging URL or controlled credentials; `BLOCKED`, not passed.
- Control: fail-closed `scripts/test-staging-idor.mjs` plus local authorization tests.
- Required evidence: controlled two-tenant deployment matrix.

### SF-002 — webhook processing lifecycle
- Severity: high
- Attack: duplicate, replay, or out-of-order signed delivery.
- Impact: duplicate side effects or lost event processing if acknowledged before durable claim.
- Current status: signature tests pass; active pull-request handler acknowledges before the historical executor and does not provide a durable production processor.
- Control: `src/github/webhookLifecycle.ts` claim/process/mark contract and state-machine regression test.
- Required fix/evidence: wire the route to durable storage/queue and run staging lifecycle tests.

### SF-003 — billing tenant binding
- Severity: high
- Attack: use another tenant's subscription ID or client-supplied plan value.
- Impact: unauthorized premium access.
- Current status: local boundary model rejects cross-tenant/forged plan cases; provider-backed tenant binding is `UNVERIFIED`.
- Control: server-side entitlement test and existing provider signature tests.
- Required evidence: provider sandbox with two controlled tenants.

## Phase 4 gate evidence

- TypeScript build: VERIFIED.
- Package-risk, identity, registry-adversarial, policy, authorization, billing, isolation, webhook security, webhook lifecycle, webhook state, benchmark, workload, and VSIX inspection checks: VERIFIED locally.
- Staging IDOR runner: BLOCKED as designed because controlled staging URL/credentials/resources are absent.
- External VS Code installation: UNVERIFIED; see `EXTERNAL_VSCODE_TEST_PLAN.md`.
- Credential scan and `git diff --check`: VERIFIED.

## Regression policy

Every confirmed vulnerability must add a permanent regression test before remediation is considered complete. A blocked staging test is not converted into a passing mock result.
