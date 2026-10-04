# Production verification checklist

## Required configuration

- `GITHUB_APP_ID`, `GITHUB_PRIVATE_KEY`, and `GITHUB_WEBHOOK_SECRET` are present and rotated through the deployment secret manager.
- `GITHUB_OAUTH_CLIENT_ID` and `GITHUB_OAUTH_CLIENT_SECRET` are present for human identity flows.
- `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are present for sessions, rate limits, and idempotency.
- Database connection variables and migrations are applied to the target environment.
- Billing provider credentials/webhook verification are configured before enabling paid entitlements.

## Deployment checks

- `/health` is live; `/ready` returns 200 only when required dependencies are configured.
- TLS terminates correctly and proxy headers are trusted only in the intended deployment topology.
- Security headers are present in production responses.
- Request body limits, rate limits, structured logs, and graceful shutdown are verified.
- Logs contain request IDs and operational failures but no tokens, secrets, passwords, or source files.

## GitHub checks

- Webhook signature, malformed payload, duplicate delivery, wrong installation, and wrong repository tests pass against the deployed route.
- The GitHub App has only required permissions and installation ownership is verified server-side.
- The canonical GitHub Actions workflow is installed and its check-run behavior is verified on a test repository.

## Extension checks

- `ide-extension` produces a VSIX with `npm run package`.
- Install the VSIX in a clean VS Code profile and verify activation, commands, supported languages, diagnostics, registry failure behavior, and configuration.
- Inspect the VSIX contents for secrets, `.env` files, unnecessary tests, and sensitive source maps.

## Evidence status

A passing local build is not production verification. Record environment, commit, date, configuration class, test command, and result for every deployment check.
