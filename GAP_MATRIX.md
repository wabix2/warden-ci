# Warden phase 2 gap matrix

| Area | Status | Evidence | Remaining gap |
|---|---|---|---|
| Shared scan engine | TESTED | `pnpm build`, package-risk tests | No deployed execution proof |
| Registry uncertainty | TESTED | `registry-unavailable` verdict and regression test | Provider chaos coverage should expand beyond fixtures |
| npm/PyPI/Cargo/Go | IMPLEMENTED / TESTED | Provider modules and extension tests | Real registry corpus not yet snapshotted |
| Evaluation benchmark | TESTED | `pnpm benchmark:evaluate`, 10 synthetic fixtures | Synthetic only; metrics are not real-world accuracy |
| Verdict evidence | IMPLEMENTED / TESTED | `PackageVerdict.reasons/evidence/confidence` | Not yet persisted as an audit event in deployed storage |
| IDE cancellation | TESTED | extension compile/test suite | Clean external VS Code install unverified |
| HTTP tenant isolation | UNIT-TESTED | authorization harness | Two-tenant deployed HTTP test unverified |
| GitHub webhook | UNIT-TESTED | signature security harness | Production lifecycle/idempotency unverified |
| Billing | UNIT-TESTED | billing state tests | Provider sandbox/webhook verification unverified |
| VSIX | BUILT / INSPECTED | package command and license inspection | External install and activation unverified |
| Audit trail | PARTIAL | schema/docs | End-to-end query and tamper-resistance evidence incomplete |
