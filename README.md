# Warden CI

<img src="./assets/warden-ci-logo-512.png" alt="Warden CI logo" width="80" />

A GitHub App that scans pull requests for AI-generated code patterns, dangerous
`eval()`/`new Function()` usage, hardcoded secrets, and hallucinated npm package
imports (packages referenced in code that don't actually exist on the npm
registry — a real supply-chain risk when AI tools invent plausible-sounding
package names).

## How it works

- **`src/server.ts`** — the Express server. Serves the landing page, the
  Gumroad-billed `/subscribe` flow and its webhook (`/billing/webhook`), and
  registers the GitHub webhook route (`/api/github/webhooks`).
- **`src/github/webhookHandler.ts`** — receives `pull_request` webhook events
  (`opened`, `synchronize`, `reopened`), verifies the GitHub signature, lists
  the PR's changed files, runs the scan, and posts the result as a GitHub
  Check Run.
- **`src/github/appAuth.ts`** — authenticates as the GitHub App and mints an
  installation-scoped Octokit client per repo/org.
- **`src/github/verifySignature.ts`** — HMAC verification for incoming
  webhooks, so only requests actually signed by GitHub are processed.
- **`src/scan/`** — the checks themselves, run only against *added* lines in
  the diff (never pre-existing code the PR didn't touch):
  - `ecosystems/` — one adapter per package registry (`npm.ts`, `pypi.ts`),
    each implementing import extraction + registry metadata lookup behind a
    shared interface (`ecosystems/types.ts`). Adding a third registry
    (crates.io, RubyGems) means writing one more adapter file, not touching
    the detection logic.
  - `riskSignals.ts` — the actual detector: a package with no registry entry
    is `hallucinated`; a package that exists but was published within the
    last 45 days *and* sits within edit-distance 2 of a popular package name
    (`popularPackages.ts`) is `typosquat-suspect`. This is meaningfully
    harder to replicate than a plain existence check — see "Differentiation"
    below.
  - `secrets.ts` — flags likely hardcoded credentials.
  - `dangerousExec.ts` — flags `eval()`, `new Function()`, unguarded shell exec.
  - `diff.ts` — parses GitHub's unified diff `patch` field into added lines
    with correct new-file line numbers.
- **`src/telemetry/corpusLog.ts`** — logs flagged-package events (package
  name, ecosystem, verdict — never code, file paths, or account identity) so
  the product accumulates a detection history over time. **Disabled by
  default** — see "Differentiation" below for why.
- **`src/billing/store.ts`** — persistent Pro-status tracking via Upstash Redis,
  keyed by GitHub account/org login.
- **`ide-extension/`** — a separate, minimal VS Code extension scaffold. See
  "Differentiation" below — this is genuinely unfinished, not just undocumented.

## Differentiation — the four things meant to make this hard to just copy

A plain "does this package exist" check is trivial to replicate — a
competitor (or GitHub itself) could ship it in an afternoon. The product moat
is the enforcement workflow: deterministic evidence, fail-closed policy, and
an audit trail that teams can trust during an incident. These four are
the actual attempt at defensibility, in honest current state:

1. **Detection corpus (`telemetry/corpusLog.ts`)** — every flagged package,
   logged over time, across every install. This is the strongest one: it
   compounds with usage, so a competitor starting later has no way to
   shortcut past your history. **Status: enabled for public-repository scans.**
   Raw events expire after 90 days and aggregate counts after 365 days. Private
   repositories are excluded by default, and each installation can opt out (or
   explicitly opt in for private scans). The logger stores only ecosystem,
   package name, verdict, optional impersonated package, and timestamp — never
   code, paths, repository names, identity, or installation IDs.
2. **Package-risk signals (`riskSignals.ts`)** — catches near-miss
   package names published recently, not just nonexistent ones. **Status:
   built and live**, using a daily background refresh from npm's official
   downloads API and pypistats.org. The checked-in lists are bootstrap
   candidates; complete snapshots are ranked to the top 100, cached in Redis,
   and retained in memory when sources fail. The refresh never runs on the PR
   request path. Public metadata cannot prove a private-name collision: classic dependency confusion requires an organization's internal package list. Warden therefore uses only a narrow high-version/thin-history proxy, and maintainer-change detection is npm-only because PyPI JSON does not expose uploader identity.
3. **Multi-ecosystem breadth (`ecosystems/`)** — npm and PyPI both work
   today, behind a shared interface designed so a third registry is an
   adapter, not a rewrite. **Status: built and live** for these two;
   crates.io/RubyGems are not implemented.
4. **Upstream integration (`ide-extension/`)** — the biggest actual moat
   candidate, since it puts the check where the hallucination originates
   (accepting an AI suggestion) rather than after it's committed. **Status:
   a real but minimal scaffold** — npm existence checks only, no
   typosquat/PyPI parity, and not published anywhere. Publishing needs a VS
   Code Marketplace publisher account, which is a step only you can do.

## Not yet built

Beyond what's noted above: no `/fix` auto-remediation, no `issue_comment`
handling, and no per-run detail page (`/details` is still a static page, not
a rendered report of a specific scan). Private-repo scanning IS now gated on
Pro status (`isProActive` in `billing/store.ts`, checked in
`webhookHandler.ts` before scanning private repos) — that used to be sold but
unenforced; it's enforced now.

## Pricing

Configurable via the `GUMROAD_CHECKOUT_*` and `GUMROAD_PRODUCT_*` env vars — see below. Only
plans with configured Gumroad values are shown to customers on `/subscribe`.
The current paid boundary is intentionally narrow and enforceable. Gumroad Pro is the only sellable paid tier; Team and Enterprise are not advertised as active products:

- **Free**: public repository scanning.
- **Pro**: private repository scanning plus blocking checks.
- **Team** / **Enterprise**: hidden until their organization controls and audit
  workflows are implemented; do not sell capabilities that are not live.

## Setup

```bash
npm install
cp .env.example .env
```

Fill in `.env` — see the comments in `.env.example` for where each value comes
from. For the Gumroad side specifically, follow [`BILLING_SETUP.md`](./BILLING_SETUP.md)
step by step.

### GitHub App setup (required for scanning to work at all)

1. Create a GitHub App at <https://github.com/settings/apps/new> (or use
   `app.yml` as a reference for the permissions/events to select: `checks:
   write`, `contents: read`, `pull requests: read`, subscribed to the
   `pull_request` event).
2. Set the **Webhook URL** to `https://<your-deployed-domain>/api/github/webhooks`.
3. Generate a **Webhook secret** — put it in `GITHUB_WEBHOOK_SECRET`.
4. Generate a **private key** (downloads a `.pem`) — paste its full contents
   into `GITHUB_PRIVATE_KEY`.
5. Copy the **App ID** into `GITHUB_APP_ID`.
6. Install the app on a test repo, open a PR that imports a nonexistent
   package or a hardcoded-looking secret, and confirm a "Warden CI" Check
   Run appears with findings.

## Local development

```bash
npm run dev
```

Use [smee.io](https://smee.io) or the GitHub CLI's webhook forwarding to route
webhook deliveries to your local machine while developing.

## Deploying

Standard Node app — `npm run build && npm start`. Works on Render, Fly.io,
Railway, or anywhere else that runs Node 18+.

**Free-tier note**: Render's free tier spins down after ~15 minutes of
inactivity and restarts on the next request. Billing state now survives this
correctly (see `billing/store.ts`, backed by Upstash Redis — this replaced an
earlier in-memory version that silently lost every customer's Pro access on
every restart). If you're taking real payments, consider whether the ~30s
cold-start delay after a spin-down is acceptable for your customers, or
whether it's time to move to a paid instance.

## Enterprise outputs and policy

The scan API supports `?format=sarif` for GitHub code-scanning-compatible results and `?format=cyclonedx` for dependency inventory exchange. Copy `warden-policy.example.json` to `warden-policy.json` and review it in code review; policy history and suppressions are persisted in Neon so exceptions are attributable and can expire.

The repository also includes `.github/workflows/warden-scan.yml` as a reference GitHub Action. It fails closed when the API reports blocking findings and requires `WARDEN_URL` plus `WARDEN_API_TOKEN` repository secrets.

## Local and CI scanning

Warden exposes the same scanner through a token-protected API for CI and editor integrations. Set `WARDEN_URL` and `WARDEN_API_TOKEN`, then run `pnpm warden-scan path/to/diff.patch`; exit code 1 means the gate failed. The endpoint rejects unauthenticated requests and does not send source contents to telemetry.

## Before going live — checklist

- [ ] All `GUMROAD_CHECKOUT_*` and `GUMROAD_PRODUCT_*` values are configured.
- [ ] `GUMROAD_WEBHOOK_SECRET` is configured and Gumroad pings
      `https://<your-deployed-domain>/billing/webhook`.
- [ ] Gumroad products and recurring billing settings are live and reviewed.

- [ ] `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` are set — without
      these, Pro status won't persist at all.
- [ ] Fill in the `[DATE]`, `[YOUR COMPANY/NAME]`, and `[YOUR SUPPORT EMAIL]`
      placeholders in [`TERMS.md`](./TERMS.md) and [`PRIVACY.md`](./PRIVACY.md)
      — don't launch with placeholder legal text.
- [ ] Test the full paid flow once in sandbox mode before flipping to
      production: private repo → PR → upgrade link → checkout → webhook
      received (check Render logs for `[billing] received Gumroad webhook`) →
      re-sync the PR → scan runs instead of showing the upgrade gate.
