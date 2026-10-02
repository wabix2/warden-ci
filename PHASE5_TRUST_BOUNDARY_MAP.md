# Phase 5 webhook trust-boundary map

## Active route

`POST /api/github/webhooks` is mounted before `express.json()` with `express.raw({ type: "application/json" })`.

Request path:

1. raw body is captured;
2. `x-hub-signature-256` is verified against `GITHUB_WEBHOOK_SECRET`;
3. `x-github-event` and `x-github-delivery` are required;
4. actionable `pull_request` payload identity is extracted from the signed payload;
5. delivery is claimed in `warden_github_webhook_events` using the unique delivery ID;
6. duplicate/stale claims are acknowledged without side effects;
7. a newly claimed event is acknowledged with `202` only after durable claim succeeds;
8. processing calls the durable lifecycle boundary and marks processed or failed.

## Durable identity

Each record contains delivery ID, GitHub event type, payload fingerprint, installation ID, repository ID, occurrence time, status, attempt, error, and processing timestamps. Installation and repository identifiers are sourced from the signed GitHub payload, not request query/body overrides.

## Failure boundary

If signature, identity, parsing, or durable claim fails, no successful acknowledgement is sent. A delivery that is durably claimed but processing fails is marked failed and remains observable for retry. Duplicate delivery IDs cannot create a second logical claim.

## Current external limitation

The repository's historical scan/check-run executor was commented out in the active handler. The new production route makes the durable acknowledgement boundary explicit and invokes the processor dependency, but a deployed worker that performs the full scan/check-run side effects and recovers after process termination remains integration/staging evidence to execute.
