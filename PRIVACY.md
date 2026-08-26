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
- **Paddle**: if you subscribe to the Pro plan, Paddle acts as Merchant of
  Record for your payment — we never see or store your card details, and
  Paddle (not us) handles applicable sales tax/VAT on your purchase. We store
  your Paddle customer ID and subscription status to know whether to unlock
  private-repo scanning.

## Detection corpus (only if telemetry is enabled — see below)

**⚠️ TODO before this section is accurate: `WARDEN_TELEMETRY_ENABLED` currently
defaults to off. Do not set it to `true` for real customers until this section
has actually been reviewed and this policy is genuinely in effect — this text
exists so the disclosure is ready when that decision is made, not as
confirmation it's already happening.**

When enabled, Warden CI records which package names get flagged as
non-existent or typosquat-suspect, across all installations, to improve
detection accuracy over time. What is stored:
- The flagged package name, its registry (npm/PyPI), and the verdict.
- The GitHub installation ID that triggered the flag (an opaque number, not
  your account name or email).

What is **never** stored as part of this: your source code, file paths, file
contents, repository names, or your GitHub account/organization login. This
data cannot be used to identify what code you're writing — only which package
names have been flagged, in aggregate, across the product.

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
