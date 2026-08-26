# Billing setup guide (Paddle)

Two accounts to create, both free to start. Do this in order.

## 1. Upstash Redis (billing data store)

1. Go to [upstash.com](https://upstash.com) → sign up free (GitHub login is fine).
2. **Create Database** → any name (e.g. `warden-ci-billing`) → region close to
   wherever you deploy → **free** tier.
3. On the database's page, find **REST API**. Copy:
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`
4. Paste both into your host's environment variables.

## 2. Paddle (payments — Merchant of Record)

Paddle supports sellers based in Ethiopia directly, so use your real business
details throughout — no location workaround needed or wanted here.

### a. Create your account and product

1. Go to [paddle.com](https://paddle.com) → sign up. You'll start in
   **Sandbox** mode automatically — stay there until the full flow is tested.
2. Complete the seller verification steps Paddle asks for (identity, business
   details). Use your real Ethiopia-based information.
3. **Catalog → Products → New product**: name it `Warden CI Pro`.
4. Add a **Price**: $49.00, **Recurring**, **Monthly**. Save, then copy the
   Price ID (starts with `pri_`) → this is `PADDLE_PRICE_ID`.

### b. Get your API credentials

1. **Developer tools → Authentication**.
2. Copy the **API key** → `PADDLE_API_KEY` (keep this secret, server-side only).
3. Copy the **Client-side token** → `PADDLE_CLIENT_TOKEN` (this one is safe to
   expose in the browser — it's what the checkout page uses).

### c. Set up the webhook

1. **Developer tools → Notifications → New destination**.
2. URL: `https://YOUR-DEPLOYED-URL/billing/webhook`
   (e.g. `https://warden-ci.onrender.com/billing/webhook`)
3. Events to send — select:
   - `transaction.completed`
   - `subscription.created`
   - `subscription.updated`
   - `subscription.canceled`
4. Save. Copy the destination's **secret key** → `PADDLE_WEBHOOK_SECRET`.

### d. Set your app's base URL and environment

- `APP_BASE_URL`: your deployed URL, no trailing slash, e.g.
  `https://warden-ci.onrender.com`.
- `PADDLE_ENVIRONMENT`: `sandbox` for now.

## 3. Test the full flow before going live

1. Deploy with all env vars set (sandbox Paddle credentials are fine).
2. Install the GitHub App on a private repo you own, or make an existing test
   repo private.
3. Open a PR — you should see "Private repo scanning requires Warden CI Pro"
   with an upgrade link.
4. Click it → the page should open Paddle's checkout overlay. Use
   [Paddle's sandbox test card numbers](https://developer.paddle.com/concepts/payment-methods/credit-debit-card#testing)
   to complete a fake purchase.
5. Check **Paddle Dashboard → Notifications → [your destination] → recent
   deliveries** to confirm your app received `transaction.completed` and
   responded 200.
6. Re-sync the same PR (push an empty commit) — the gate should be gone and a
   normal scan should run.

## 4. Go live

Once the sandbox flow works end to end:

1. Complete any additional verification Paddle requires to leave sandbox mode.
2. Repeat steps 2a–2c for **production** — Paddle issues separate live
   credentials and price IDs from sandbox.
3. Update your deployed env vars: new `PADDLE_API_KEY`, `PADDLE_CLIENT_TOKEN`,
   `PADDLE_PRICE_ID`, `PADDLE_WEBHOOK_SECRET`, and set
   `PADDLE_ENVIRONMENT=production`.
4. Fill in the placeholders in `TERMS.md` and `PRIVACY.md`, and link to them
   somewhere a paying customer will see them.
