# Phase 4 Trust Boundary Map

Status labels: `IMPLEMENTED`, `TESTED`, `INTEGRATION-TESTED`, `STAGING`, `EXTERNALLY VERIFIED`, `UNVERIFIED`, `BLOCKED`.

## Request chain

`client -> Express route -> authentication/principal resolution -> tenant/resource lookup -> server-side authorization -> response or state change`.

The repository currently mixes three trust domains:

1. GitHub OAuth/API identity for repository/run access.
2. Warden API bearer token for internal automation routes.
3. Signed provider webhooks for GitHub and Gumroad.

No client-supplied tenant, installation, repository, scan, audit, policy, or subscription identifier is sufficient authorization by itself. Where an endpoint does not resolve a server-side owner relationship, that is a Phase 4 risk requiring staging verification or remediation.

## Endpoint inventory

| Surface | Auth mechanism | Principal | Server-side owner/resource resolution | Client-controlled identifiers | Current evidence | Risk/status |
|---|---|---|---|---|---|---|
| `/health`, `/ready` | none | anonymous | dependency/config status only | none | local route review | IMPLEMENTED; metadata intentionally public |
| `/api/check/package` | public scanner endpoint | anonymous | package registry identity only | ecosystem, package | package-risk tests | TESTED; no tenant data |
| `/api/runs/:runId` | GitHub OAuth token | GitHub user | run -> repository -> installation, then GitHub repo access | runId | authorization tests | TESTED locally; deployed IDOR UNVERIFIED |
| `/api/runs/:runId/findings` | GitHub OAuth token | GitHub user | same run/repository/install chain | runId | authorization tests | TESTED locally; deployed IDOR UNVERIFIED |
| `/api/dashboard` | GitHub OAuth token | GitHub user | installation/repository access through GitHub API | installationId, repositoryId | route/helper review | STAGING BLOCKED |
| `/api/policy/*` | GitHub OAuth token | GitHub user | policy -> installation relationship | installationId, policyId | local policy tests | STAGING BLOCKED |
| `/api/audit/*` | GitHub OAuth token | GitHub user | audit event -> installation | installationId, auditId | local review | STAGING BLOCKED |
| `/api/billing/*` | provider/server state | owner or installation context | Redis owner key; DB entitlement schema available | owner, subscriptionId | local billing tests | tenant binding UNVERIFIED |
| `/billing/webhook` | Gumroad signature | provider | sale/subscription -> server record | provider fields | signature tests | provider lifecycle UNVERIFIED |
| `/api/github/webhooks` | GitHub HMAC | GitHub App installation | payload installation/repository | delivery/event payload | signature tests | lifecycle/idempotency PARTIALLY VERIFIED |
| `/api/automation/*` | Warden bearer token or Gmail subject | automation principal | token/subject scoped by route implementation | approvalId, recipients | local route review | external tenant model not applicable/UNVERIFIED |

## Known boundary concerns

- Billing currently uses owner-login Redis keys rather than a tenant-first subscription relation.
- The active pull-request webhook acknowledges actionable events before scan processing; the historical executor is commented out. This is not a production lifecycle claim.
- A controlled Vercel deployment URL, separate staging identities, isolated data stores, and provider sandbox credentials are not present in repository evidence.
- Response-body, timing, cache, and logs must be checked in staging; local helper tests cannot prove deployed isolation.

## Required staging matrix

| Tenant | User | Installation | Repository | Subscription |
|---|---|---|---|---|
| TENANT_A | USER_A | INSTALLATION_A | REPO_A | SUBSCRIPTION_A |
| TENANT_B | USER_B | INSTALLATION_B | REPO_B | SUBSCRIPTION_B |

A positive request must resolve through the authenticated principal and server-side relationship. Replacing any identifier with the other tenant's value must deny without returning the target object's data.

## Evidence status

- Local route and helper mapping: `TESTED`.
- Controlled two-tenant HTTP deployment: `BLOCKED` until staging URL/credentials/resources exist.
- Provider-backed billing: `BLOCKED` until sandbox credentials exist.
- Clean VS Code installation: `UNVERIFIED`; see `EXTERNAL_VSCODE_TEST_PLAN.md`.
