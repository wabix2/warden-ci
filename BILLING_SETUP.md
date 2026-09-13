# Billing setup guide (Gumroad)

## 1. Gumroad connector

Warden Pro billing uses the attached Vercel Connect app connector `gumroad.com/warden-pro-billing` for server-side Gumroad API verification. The connector token is never sent to browsers or stored in Redis. The connector is attached to the Vercel project; deployments running outside Vercel, including Render, must either run the same connector-aware deployment or retain the existing signed Gumroad webhook configuration until Connect is available in that runtime.

## 2. Upstash Redis

Create an Upstash Redis database and configure `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` in the deployment environment.

## 3. Gumroad products

Create one recurring Gumroad product for each tier: Pro, Team, and Enterprise. Copy each product URL into `GUMROAD_CHECKOUT_PRO`, `GUMROAD_CHECKOUT_TEAM`, and `GUMROAD_CHECKOUT_ENTERPRISE`, and copy each product ID into the matching `GUMROAD_PRODUCT_*` variable. The product IDs are used server-side to determine the plan; client query parameters are never trusted for access.

## 4. Gumroad webhook

Configure Gumroad’s ping notification URL as:

`https://YOUR_DEPLOYED_URL/billing/webhook`

Set the webhook secret in `GUMROAD_WEBHOOK_SECRET`. Configure Gumroad to send sale, subscription, cancellation, and refund notifications. The checkout page includes `github_owner` and `plan` context; verify that those values arrive in `custom_fields` in the ping payload.

## 5. Test

Deploy with the Gumroad variables and Redis configured. Open `/subscribe?owner=YOUR_GITHUB_LOGIN&plan=pro`, complete a test purchase, and confirm the ping returns HTTP 200 and the Redis record becomes active. Replay the same sale notification to verify it is idempotent, then send a refund or cancellation notification and confirm private-repository scans are gated again.

Set `GUMROAD_CHECKOUT_ENABLED=false` to temporarily show the waitlist while products or webhooks are being configured.

Never commit secrets or production environment values.
