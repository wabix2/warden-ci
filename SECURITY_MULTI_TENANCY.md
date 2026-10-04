# Multi-tenancy security evidence

## Deterministic model

- TENANT_A / USER_A / INSTALLATION_A / REPO_A
- TENANT_B / USER_B / INSTALLATION_B / REPO_B

## Verified locally

- Session extraction validates presence, shape, and expiry.
- Run authorization scopes repository access through the GitHub installation API response.
- Malformed session identifiers are rejected by the authorization helper test.
- Installation-repository write authorization has explicit negative-path tests.

## Required HTTP-boundary matrix

| Actor | Resource | Expected | Current evidence |
|---|---|---:|---|
| USER_A | INSTALLATION_A / REPO_A | allow | helper-level tests |
| USER_A | INSTALLATION_B / REPO_B | deny | deployed HTTP test pending |
| USER_B | INSTALLATION_A / REPO_A | deny | deployed HTTP test pending |
| USER_A | audit/policy/billing B | deny | endpoint-specific deployed test pending |
| expired or malformed session | any resource | deny | helper-level tests |

## Residual risk

No deployed two-tenant environment, real GitHub identities, or production database fixture was available during this pass. Therefore cross-tenant HTTP isolation is UNVERIFIED, not claimed secure.
