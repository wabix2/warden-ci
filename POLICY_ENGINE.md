# Warden policy engine

Warden policies use schema `v1` and default to `report` mode for new repositories. Teams opt into `block` mode only after reviewing findings and configuring protected-branch enforcement.

## Enterprise foundation

- **Versioned policy**: every revision has a schema, revision number, and optional parent revision.
- **Inheritance**: repository policies can inherit organization defaults; child revisions are explicit and incremented.
- **Signed revisions**: deployments can require HMAC-signed policy envelopes using `WARDEN_POLICY_SIGNING_SECRET`.
- **Scoped suppressions**: suppressions require an owner, reason, fingerprint/category scope, and expiration.
- **Audit evidence**: policy events include actor, action, revision, mode, timestamp, and policy digest.
- **Standard exports**: policy results can be exported as SARIF 2.1.0 and CycloneDX 1.5-compatible vulnerability BOM data.

## Policy API

All routes authenticate with the dashboard GitHub session (`getOAuthSession`) and
authorize the caller against the installation they own (`dashboardInstallation`),
exactly like `/api/dashboard/summary` and `/api/billing/status`. Installations are
addressed by their numeric GitHub installation id.

- `GET /api/policy/installations` — lists the GitHub App installations owned by the
  signed-in account, used to populate the editor's installation selector.
- `GET /api/policy?installationId=&repositoryId=` — returns the effective policy (the
  latest versioned policy merged over `DEFAULT_POLICY`, with the suppressions table
  merged in), the active version number, Pro status, the suppression list, and a
  revision-history summary. `repositoryId` is accepted for forward compatibility;
  policies are currently keyed by installation.
- `PUT /api/policy` — body `{ installationId, repositoryId?, policy }`. Validates with
  `validatePolicy`, writes a new immutable row to `policyVersions` (never mutated in
  place), updates the denormalized `policies` summary row, and records a
  `policy.updated` event in `auditEvents`. Saving `mode: "block"` requires an active
  Pro plan and **fails closed** (any entitlement-check error is treated as not Pro,
  returning `402 upgrade_required`); `report` mode is always free. Field-level
  validation errors return `422` with a `field` hint the editor renders inline.
- `GET /api/policy/versions?installationId=&repositoryId=` — full revision history
  (version, author, timestamp, mode, minimum severity, stored policy) for the audit
  trail.
- `POST /api/policy/preview` — body `{ installationId, policy }`. Runs `evaluateGate`
  against the most recent scan run's stored findings for both the current and proposed
  policy and returns the blocking/suppressed/ignored counts plus the delta, powering
  the editor's live preview.
- `POST /api/policy/suppressions` — creates or updates a suppression. Enforces the
  same required fields `validatePolicy` checks: `fingerprint`, `owner`, `reason`, and a
  valid `expiresAt`. Owner is stored in the table's `created_by` column.
- `DELETE /api/policy/suppressions/:id` — removes a suppression owned by the caller's
  installation and records a `policy.suppression.deleted` audit event.

Stored policies also drive real scan verdicts: `/api/scan` loads the effective policy
for the scanned repository and feeds it through `evaluateGate` (via `scanFiles`), again
coercing `block` mode to `report` unless Pro is verified live, so an outage never fails
a CI job into paid blocking behavior.

## Policy editor UI

`/policy` (served from `policy.html`, matching `report.html`'s dark theme and
`escapeHtml` conventions) is the customer-facing editor:

- Enforcement-mode toggle (report/block), minimum-severity dropdown, block-category
  checkboxes (secret, execution, dependency), and editable tag lists for ignored paths
  and ignored packages.
- A suppressions table with add/remove controls and required owner, reason, and expiry
  fields.
- A live preview that calls `POST /api/policy/preview` and reports how many findings
  from the last scan the proposed policy would block versus the current one.
- Block mode is disabled with an inline upgrade prompt for non-Pro accounts, mirroring
  how `report.html` handles `upgrade_required`.
- Save calls `PUT /api/policy` and renders `validatePolicy` failures inline per field.

The editor is linked from `dashboard.html` and from `report.html`'s report-actions nav.

## Rollout

1. Start with `mode: report` and `failOnIncomplete: false`.
2. Review the customer report and suppression ownership weekly.
3. Add short-lived suppressions only with an issue or ticket reference in `reason`.
4. Sign policy revisions in CI before changing to `mode: block`.
5. Enable protected-branch required checks after the baseline is clean.

The policy engine does not infer that a created pull request fixed a vulnerability. A finding is only resolved after a subsequent scan verifies the relevant fingerprint is absent.
