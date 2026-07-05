# Warden CI

A GitHub App that scans pull requests for AI-generated, unverifiable, or tampered
code — and flags newly-published or low-adoption dependencies that look like
typosquats or hallucinated package names.

This is the Year 1 product from the Warden execution plan: single wedge, single
revenue engine, built to prove the detection engine works before expanding into
media provenance and text verification.

## How it works

1. **Heuristics (`src/heuristics.ts`)** — free, instant, regex + lightweight AST
   checks on every changed file. Flags things like leaked generation artifacts
   ("Here's an updated version of..."), obvious/redundant comments, generic
   identifier density, and duplicate function structures typical of
   template-per-endpoint generation.
2. **LLM escalation (`src/llmClassifier.ts`)** — only files that land in the
   *uncertain* heuristic band (score 20–60) get sent to **Gemini** for a second
   opinion. This keeps cost proportional to ambiguity, not diff size. Uses
   `gemini-2.0-flash`; drop to `gemini-1.5-flash` if your API key doesn't have
   access to 2.0 yet.
3. **Dependency provenance (`src/dependencyCheck.ts`)** — checks any package
   added in `package.json` / `requirements.txt` against the npm/PyPI registries.
   Risk only escalates to "high" when a package is **both** brand-new **and**
   low-adoption — either signal alone is too common in legitimate niche/internal
   packages to be worth flagging on its own.
4. **Scoring (`src/scoring.ts`)** — blends heuristic + LLM scores into a 0–100
   risk score per file and an overall PR score.
5. **`src/index.ts`** — the Probot app: listens for `pull_request` events,
   posts an in-progress GitHub Check, runs the scan, updates the Check with a
   summary + inline annotations, and exposes a `/healthz` endpoint for host
   health checks.
6. **`src/server.ts`** — the actual process entrypoint used in production.
   Normalizes `PRIVATE_KEY` (handles escaped newlines from secret-store UIs),
   writes it to a temp file, and binds to `0.0.0.0:$PORT` so it works
   identically on Fly.io, Render, Railway, or anywhere else.

## Setup

```bash
npm install
cp .env.example .env
```

You'll need:
- A **GitHub App** (create one at github.com/settings/apps, or use `app.yml`
  as a manifest via Probot's `npx probot@latest setup` flow). Grant it
  `checks:write`, `contents:read`, `pull_requests:read`, subscribed to the
  `pull_request` event. Fill in `APP_ID`, `PRIVATE_KEY`, `WEBHOOK_SECRET`
  in `.env`.
- A **Gemini API key** from aistudio.google.com for the LLM escalation step —
  set `GEMINI_API_KEY` in `.env`.

**If you already generated a private key and it touched any chat window, AI
agent, or screenshot along the way: revoke it now** at
`github.com/settings/apps/your-app` → Private keys → delete → generate a new
one. Treat any key that passed through a chat as compromised, regardless of
whether it was actually leaked further.

## Local development

```bash
npm run dev
```

Use a tool like [smee.io](https://smee.io) or the GitHub CLI's webhook forwarding
to route webhook deliveries to your local machine while developing.

## Testing

The heuristics engine has unit tests that run with no network access required:

```bash
npm test
```

This builds the TypeScript and runs `src/heuristics.test.ts` against the compiled
output using Node's built-in test runner.

## Deploying for free

**Recommended: Fly.io.** Genuinely free (3 shared VMs, no trial-credit expiry),
and gives you a stable `https://your-app.fly.dev` webhook URL.

```bash
# from the warden-ci/ directory
fly launch          # accept defaults; say no to a Postgres/Redis database
fly secrets set APP_ID=... PRIVATE_KEY="$(cat your-key.pem)" WEBHOOK_SECRET=... GEMINI_API_KEY=...
fly deploy
```

Fly's generated `fly.toml` will need an `internal_port` matching `PORT` (3000
by default here) and an HTTP health check pointed at `/healthz`.

**Fallback: Render free tier.** Also genuinely free, but spins down after 15
minutes idle — first webhook after a sleep gets a ~30s delay (GitHub retries
automatically, so this isn't fatal, just not instant). Set the same 4 env vars
under the service's Environment tab, and point Render's health check at
`/healthz`.

**Not recommended for "free": Railway.** Good developer experience, but the
$5/month credit is a trial, not a free tier — it runs out.

## GitHub App setup

1. Create the app at `github.com/settings/apps/new`:
   - Webhook URL: `https://your-deployed-url/api/github/webhooks`
   - Webhook secret: matches `WEBHOOK_SECRET`
   - Permissions: Checks (read & write), Contents (read-only), Pull requests (read-only)
   - Subscribe to: Pull request
2. Copy the App ID into `APP_ID`.
3. Generate a private key, paste its full contents into `PRIVATE_KEY`.
4. Install the app on a test repo.
5. Open a PR — a "Warden CI" check should appear within a few seconds.

## Tuning the detection engine

The thresholds in `src/scoring.ts` (`UNCERTAIN_BAND_LOW/HIGH`) and
`src/dependencyCheck.ts` (`NEW_PACKAGE_DAYS_THRESHOLD`, `LOW_DOWNLOADS_THRESHOLD`)
are starting guesses, not calibrated values. Per the Year 1 plan,
**false-positive rate is the core IP quality metric** — track it from day one
(e.g. log every scan's verdict + whether a human later disagreed) and adjust
these thresholds and the heuristic weights in `src/heuristics.ts` accordingly.
Everything in the codebase is deliberately rule-based and inspectable rather
than a black box, since "trust our score" isn't sellable without that.

## What's intentionally not built yet (out of scope for the MVP)

- Free tier / paid tier gating and billing (Stripe) — needed before the Q2
  Marketplace launch per the plan, not needed to prove the engine works.
- Org-wide dashboards and SOC2-adjacent audit log export — Q3 enterprise features.
- Full-file AST parsing (currently reconstructs a best-effort AST from added diff
  lines only, which catches real signal but isn't as accurate as parsing full
  file content — would require fetching full file blobs via the Contents API).
