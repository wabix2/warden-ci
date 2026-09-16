# Warden CI Threat Model

Status: engineering threat model; deployment-specific verification remains required.

## Assets and trust boundaries

- GitHub OAuth access tokens, app credentials, and webhook secrets.
- Repository metadata, scan findings, policies, audit records, and billing entitlements.
- Boundaries: browser/VS Code extension to Warden API; GitHub to webhook endpoint; Warden to GitHub APIs; Warden to package registries; Warden to Redis/Postgres.

## Threats and verification

| Threat | Attack | Mitigation | Verification |
| --- | --- | --- | --- |
| False-safe registry result | Registry timeout or malformed response | Providers represent unavailable state and do not fail open | Package-risk regression and chaos fixtures |
| OAuth session replay | Reuse expired or malformed cookie/session record | Structured session validation and expiry check | Authorization tests, including malformed identifiers and expired sessions |
| Repository IDOR | Change run/repository/installation identifier | Authorization derives installation and repository from the server-side run row, then verifies GitHub access | Cross-installation authorization tests |
| Webhook forgery | Submit altered payload or signature | HMAC SHA-256 verification over raw bytes | Webhook security harness |
| Webhook duplication | Replay delivery identifier | Delivery idempotency exists in the deferred handler path; production activation remains unverified | Requires enabled-handler integration test |
| Tenant audit exposure | Query another tenant's audit identifier | Must enforce tenant scope at every audit query | Production integration test still required |
| Cache poisoning | Reuse result across provider/package/version | Cache keys and TTL must include provider and package identity | Cache-specific adversarial suite required |
| Token leakage | Log or return secrets | Structured logs omit credentials; review deployment logs | Secret scan and log review required |
| Malicious extension input | Pathological or malformed source text | Bounded extraction and asynchronous diagnostics | Extension parser and packaging tests |
| Billing forgery | Fake success URL or webhook | Entitlements must be derived server-side from verified provider state | Billing integration verification remains pending |

## Residual risks

- The current GitHub webhook handler intentionally returns after signature/action validation because GitHub Actions is the canonical gate; the deferred scanning branch is not production evidence until enabled and tested end-to-end.
- Redis/Postgres tenant isolation, audit mutation controls, and billing provider authenticity require deployment-backed integration tests.
- Registry intelligence is evidence-based but cannot prove AI authorship; nonexistent packages should be described as registry-nonexistent or AI-associated only when provenance exists.
