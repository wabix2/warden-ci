# Privacy Policy — Warden CI

**This is a starting template, not legal advice.** Have a lawyer review this
before relying on it, especially if you'll have customers in the EU/UK (GDPR)
or California (CCPA) — those have specific disclosure requirements this
template does not fully cover.

_Last updated: August 21, 2026  

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
use the public/private controls. The API verifies that the authorized GitHub
account administers that installation; public installations may opt out and
private installations may opt in. Telemetry failures never fail or alter a scan.

The corpus never stores source code, diff content, file paths, repository names,
organization or user logins, GitHub installation IDs, billing identifiers, or
account identity. The logger's input type intentionally contains only the five
disclosed package-event fields, making those exclusions structural rather than
caller convention.


## What we store

- Your GitHub account/organization login and billing status (free / trialing / active
  / canceled), stored in our billing database (Upstash Redis).
- We do **not** persistently store your source code. Diffs are processed
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
