# Warden capability gap matrix

| Capability | Status | Evidence |
|---|---|---|
| Shared scan engine | TESTED | `pnpm build`, package-risk, regression benchmark |
| Explicit registry UNKNOWN | TESTED | outage regression and adversarial registry tests |
| Structured verdict evidence | TESTED | risk engine types and package-risk suite |
| Package identity canonicalization | PARTIALLY VERIFIED | npm/PyPI/Cargo/Go identity tests; full provider threading remains |
| Synthetic evaluation corpus | TESTED | 10-fixture report with confusion and expanded metrics |
| External evaluation corpus | UNVERIFIED | schema/provenance directory exists; no externally labeled corpus loaded |
| Tenant helper authorization | TESTED | authorization and multi-tenant attack harnesses |
| Deployed HTTP tenant isolation | UNVERIFIED | requires deployed two-tenant fixtures |
| GitHub installation lifecycle | PARTIALLY VERIFIED | server-side permission lookup; lifecycle events not externally exercised |
| Webhook signature verification | TESTED | raw-byte signature and malformed signature tests |
| Webhook idempotent lifecycle | UNVERIFIED | active handler acknowledges before deferred executor; provider lifecycle pending |
| Billing server authority | TESTED LOCALLY | Redis-backed server entitlement and billing tests |
| Provider-backed billing | UNVERIFIED | requires provider sandbox credentials and replay testing |
| VSIX reproducibility | TESTED | extension compile, tests, package, manifest inspection |
| Clean external VS Code install | UNVERIFIED | no clean VS Code executable in environment |
| Privacy minimization | DOCUMENTED / PARTIALLY VERIFIED | client sends package/check metadata; deployed traffic inspection pending |
| Performance | TESTED LOCALLY | 1/10/100/1000 local workload harness; not an SLA |
| Proof-of-value workflow | IMPLEMENTED | `demo/README.md` plus deterministic benchmark fixtures |
