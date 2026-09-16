# Warden capability gap matrix

| Capability | Local | Integration | Staging | External | Status | Evidence |
|---|---|---|---|---|---|---|
| Shared scan engine | VERIFIED | n/a | n/a | n/a | TESTED | build and regression suites |
| Explicit registry UNKNOWN | VERIFIED | VERIFIED | n/a | n/a | TESTED | outage/adversarial tests |
| Structured verdict evidence | VERIFIED | n/a | n/a | n/a | TESTED | risk engine tests |
| Package identity canonicalization | VERIFIED | PARTIAL | n/a | n/a | PARTIALLY VERIFIED | identity tests; provider threading incomplete |
| Synthetic evaluation corpus | VERIFIED | n/a | n/a | n/a | TESTED SYNTHETIC | benchmark reports |
| External evaluation corpus | schema only | n/a | n/a | UNVERIFIED | UNVERIFIED | no externally labeled corpus loaded |
| Tenant helper authorization | VERIFIED | VERIFIED | n/a | n/a | TESTED | authorization harnesses |
| Deployed HTTP tenant isolation | harness only | n/a | BLOCKED | n/a | BLOCKED | no controlled deployment/identities |
| IDOR/BOLA staging attacks | fail-closed runner | n/a | BLOCKED | n/a | BLOCKED | scripts/test-staging-idor.mjs |
| GitHub installation lifecycle | helper logic | PARTIAL | BLOCKED | n/a | PARTIALLY VERIFIED | staging resources unavailable |
| Webhook signature verification | VERIFIED | VERIFIED | BLOCKED | n/a | TESTED | raw-byte signature tests |
| Webhook durable lifecycle | VERIFIED state model | not wired | BLOCKED | n/a | UNVERIFIED | WEBHOOK_STATE_MACHINE.md |
| Billing server authority | VERIFIED | local adapter | BLOCKED | n/a | PARTIALLY VERIFIED | billing boundary tests |
| Provider-backed billing | unavailable | unavailable | BLOCKED | n/a | UNVERIFIED | provider sandbox unavailable |
| Cache isolation | VERIFIED model | n/a | BLOCKED | n/a | PARTIALLY VERIFIED | isolation harness |
| Async job isolation | VERIFIED model | n/a | BLOCKED | n/a | PARTIALLY VERIFIED | isolation harness |
| VSIX reproducibility | VERIFIED | n/a | n/a | UNVERIFIED clean install | PARTIALLY VERIFIED | package inspection |
| Privacy minimization | documented | local request review | UNVERIFIED traffic | n/a | PARTIALLY VERIFIED | PRIVACY.md |

## Phase 4 prerequisites

A dedicated staging deployment, two controlled tenant credentials, isolated database/Redis, GitHub App staging installation(s), webhook secret, and optional provider sandbox credentials are required to move blocked rows to staging evidence. The repository intentionally does not fabricate those resources.
