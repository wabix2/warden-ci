# Warden threat model

| Asset | Attacker | Preconditions / attack | Existing control | Test | Residual risk |
|---|---|---|---|---|---|
| Scan verdict | malicious package author | manipulates metadata or name | provider normalization, evidence, UNKNOWN state | registry adversarial tests | metadata can be incomplete |
| Tenant data | authenticated user | swaps IDs in HTTP request | server-side installation/repository authorization | multi-tenant helper harness | deployed HTTP isolation pending |
| GitHub installation | compromised account/member | stale or transferred repository relationship | GitHub API permission check | authorization suite | real lifecycle not externally verified |
| Webhook state | attacker/replayed delivery | forged, duplicate, reordered payload | HMAC verification and delivery-key design | lifecycle harness | active executor/lifecycle deployment pending |
| Premium entitlement | client or forged provider event | attempts client-side grant or replay | server-side Redis record and signed webhook path | billing suite | provider sandbox verification pending |
| Developer privacy | malicious workspace | repeated scan or crafted package name | package-level metadata request; no source upload in client | client review and registry tests | deployed traffic inspection pending |
| Extension stability | malicious workspace | rapid edits, close, deactivate | AbortController and generation suppression | extension tests | clean external VS Code install pending |
| Registry availability | hostile upstream | timeout, 429, malformed response | bounded fetch and registry-unavailable verdict | registry adversarial tests | provider-specific large-response limits need further deployment testing |

## Positioning constraint

Warden is intentionally scoped as control-plane security for AI-introduced dependencies across IDE, CI, policy, and evidence surfaces. Generic SAST, chatbot features, and unrelated detectors are excluded because they would dilute the central workflow and expand the attack surface without closing the current evidence gaps.
