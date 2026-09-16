# Warden CI Gap Matrix

| Area | Current state | Evidence | Severity | Required action |
| --- | --- | --- | --- | --- |
| IDE | Implemented for import detection, debounce, cache, stale suppression, and npm/PyPI/Cargo/Go routing | `ide-extension/src`, extension tests | Medium | Exercise clean external installation and offline UX |
| Registry providers | Implemented with explicit `ok`, `not_found`, and `unavailable` metadata states | `src/scan/ecosystems/*` | High | Add provider contract tests and bounded retries |
| Risk engine | Deterministic existence, typosquat, freshness, confusion, takeover, and malware-advisory signals | `src/scan/riskSignals.ts` | Medium | Expand calibrated corpus before accuracy claims |
| Unknown safety | Fixed: unavailable results are explicit `registry-unavailable` findings | risk and benchmark tests | High | Add outage tests for every provider |
| Policy | Implemented and shared by scan surfaces | `src/enforcement/policy.ts` | Medium | Add declarative configuration and exception audit events |
| Authorization | Unit-level installation/repository checks exist | `scripts/test-run-authorization.mjs` | High | Run HTTP-boundary two-tenant tests against deployed service |
| Webhooks | Signature validation is tested; route is not the scan executor | `src/github`, webhook tests | High | Implement or explicitly keep the validation-only lifecycle |
| Billing | Local entitlement state and tests exist | `src/billing`, billing tests | High | Verify real provider signatures, replay, and revocation |
| Audit | Structured audit-related modules exist | `src/audit` | Medium | Verify tenant-scoped persistence and tamper resistance in deployment |
| Benchmarks | Six deterministic fixtures and methodology exist | `benchmarks/`, benchmark script | Medium | Version a labeled multi-ecosystem corpus |
| Distribution | VSIX builds and includes MIT license | `ide-extension/package.json`, packaging check | Medium | Test clean external installation and marketplace metadata |
| Product claim | Defensible wedge is AI-assisted dependency governance, not AI provenance proof | `ARCHITECTURE.md` | Informational | Keep marketing evidence-backed |
