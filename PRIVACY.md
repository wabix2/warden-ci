# Privacy Policy — Warden CI

**This is a starting template, not legal advice.** Have a lawyer review this
before relying on it, especially if you'll have customers in the EU/UK (GDPR)
or California (CCPA) — those have specific disclosure requirements this
template does not fully cover.

_Last updated: September 12, 2026_

**Warden CI is a product of Focus Switch.**

## What we access

Warden CI is installed as a GitHub App with the following permissions:
- **Contents: read-only** — to read the diffs of changed files in a pull request.
- **Pull requests: read-only** — to see which files changed and their metadata.
- **Checks: read & write** — to post scan results back to your pull request.

## What we send to third parties

- **npm public registry**: package names (not your code) are checked for
  existence when a new `import`/`require` is added, to catch hallucinated or
  typosquatted package names. Only the package name is sent — no file content.
- **PyPI public registry**: same as above, for Python `import` statements.
- **Gumroad**: if you subscribe to the Pro plan, Gumroad acts as Merchant of
  Record for your payment — we never see or store your card details, and
  Gumroad (not us) handles applicable sales tax/VAT on your purchase. We store
  your Gumroad customer ID and subscription status to know whether to unlock
  private-repo scanning.

## Detection corpus

The detection corpus is enabled by default for public-repository scans. It stores
only these fields: `ecosystem`, `packageName`, `verdict`, optional
`impersonating`, and an ISO timestamp. The installation ID is used only to
resolve the per-installation setting and is never written into corpus events.
Raw event samples are retained for 90 days; aggregate package/verdict counts are
retained for 365 days, after which Redis expires them.

Private-repository scans are excluded by default. A customer may explicitly opt
in a GitHub installation through the dashboard: click "Connect GitHub", authorize
Warden, enter an installation ID visible in the GitHub App installation URL, and
use the public/private controls. The API verifies that GitHub authorizes the signed-in account for that specific
installation before changing settings; public installations may opt out and
private installations may opt in. GitHub's OAuth API does not expose a universal
installation-owner assertion to this app, so this is not represented as proof of
organization ownership. Telemetry failures never fail or alter a scan.

The corpus never stores source code, diff content, file paths, repository names,
organization or user logins, GitHub installation IDs, billing identifiers, or
account identity. The logger's input type intentionally contains only the five
disclosed package-event fields, making those exclusions structural rather than
caller convention.


## Authenticated security reports

Per-run reports are available only through `/details?runId=...` after GitHub OAuth. Each run is owned through the server-side chain `scan run -> repository -> GitHub App installation`; the server then asks GitHub whether the signed-in OAuth account is authorized for that exact installation. Missing runs return 404, while authenticated users without installation authorization receive 403; no run ID or repository name is treated as authorization. This verifies installation-specific access using GitHub's API and is not a claim that the account is an organization owner. Report responses omit OAuth tokens, session IDs, app keys, telemetry corpus data, and unrelated installation records.

## What we store

- Your GitHub account/organization login and billing status (free / trialing / active
  / canceled), stored in our billing database (Upstash Redis).
- Run metadata and findings needed for authorized security reports, including the
  owning installation relationship, repository context, commit SHA, and finding
  details. We do **not** persistently store your source code. Diffs are processed
  in-memory during a scan and are not retained afterward. 

## Data retention

Billing records are retained for as long as your installation is active, and
for a reasonable period afterward for accounting/legal purposes. 90 days after
uninstallation.

## Your rights

You can uninstall the GitHub App at any time, which stops all further access
to your repositories. To request deletion of your billing records, contact
wabitafese9@gmail.com.

## Changes to this policy

We may update this policy as the product changes. Material changes will be
communicated via email.

## Contact

Questions about this policy: wabitafese9@gmail.com.
