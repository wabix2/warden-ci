# Warden policy engine

Warden policies use schema `v1` and default to `report` mode for new repositories. Teams opt into `block` mode only after reviewing findings and configuring protected-branch enforcement.

## Enterprise foundation

- **Versioned policy**: every revision has a schema, revision number, and optional parent revision.
- **Inheritance**: repository policies can inherit organization defaults; child revisions are explicit and incremented.
- **Signed revisions**: deployments can require HMAC-signed policy envelopes using `WARDEN_POLICY_SIGNING_SECRET`.
- **Scoped suppressions**: suppressions require an owner, reason, fingerprint/category scope, and expiration.
- **Audit evidence**: policy events include actor, action, revision, mode, timestamp, and policy digest.
- **Standard exports**: policy results can be exported as SARIF 2.1.0 and CycloneDX 1.5-compatible vulnerability BOM data.

## Rollout

1. Start with `mode: report` and `failOnIncomplete: false`.
2. Review the customer report and suppression ownership weekly.
3. Add short-lived suppressions only with an issue or ticket reference in `reason`.
4. Sign policy revisions in CI before changing to `mode: block`.
5. Enable protected-branch required checks after the baseline is clean.

The policy engine does not infer that a created pull request fixed a vulnerability. A finding is only resolved after a subsequent scan verifies the relevant fingerprint is absent.
