import express, { Request, Response } from "express";
import path from "path";
import { readFileSync } from "fs";
import { Environment, Paddle } from "@paddle/paddle-node-sdk";
import { setProStatus, getOwnerForCustomer, addToWaitlist, getWaitlist } from "./billing/store";
import { handlePullRequestWebhook } from "./github/webhookHandler";

const app = express();
const PORT = Number(process.env.PORT || 3000);

// Fail loud at boot, not silently on the first user's request — if this prints on
// deploy, the waitlist (and Pro-status checks) will fail until it's fixed.
if (!process.env.UPSTASH_REDIS_REST_URL?.trim() || !process.env.UPSTASH_REDIS_REST_TOKEN?.trim()) {
  console.error(
    "WARNING: UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN missing or empty — " +
      "waitlist signups and Pro-status checks will fail until these are set correctly."
  );
}

if (
  !process.env.GITHUB_APP_ID?.trim() ||
  !process.env.GITHUB_PRIVATE_KEY?.trim() ||
  !process.env.GITHUB_WEBHOOK_SECRET?.trim()
) {
  console.error(
    "WARNING: GITHUB_APP_ID / GITHUB_PRIVATE_KEY / GITHUB_WEBHOOK_SECRET missing or empty — " +
      "PR scanning will not work until these are set. This is the core product; billing without a working scanner has nothing to sell."
  );
}

const paddleEnvironment =
  process.env.PADDLE_ENVIRONMENT === "production"
    ? Environment.production
    : Environment.sandbox;
const paddle = new Paddle(process.env.PADDLE_API_KEY || "", {
  environment: paddleEnvironment,
});

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function jsString(value: string): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

const plans = {
  pro: {
    name: "Pro",
    price: "$19",
    description: "For professional developers and private repositories.",
    features: [
      "Private repository scanning",
      "AI-generated code security checks",
      "Hallucinated npm package detection",
      "Line-level GitHub results",
      "Automated remediation",
    ],
    priceId: () => process.env.PADDLE_PRICE_PRO || "",
  },
  team: {
    name: "Team",
    price: "$49",
    description: "For engineering teams protecting multiple repositories.",
    features: [
      "Everything in Pro",
      "Unlimited team members",
      "Team-wide repository protection",
      "Centralized security visibility",
      "Priority support",
    ],
    priceId: () => process.env.PADDLE_PRICE_TEAM || "",
  },
  enterprise: {
    name: "Enterprise",
    price: "$149",
    description: "For organizations that need security at scale.",
    features: [
      "Everything in Team",
      "Organization-wide protection",
      "Advanced controls",
      "Enterprise support",
      "Custom security requirements",
    ],
    priceId: () => process.env.PADDLE_PRICE_ENTERPRISE || "",
  },
} as const;

type PlanKey = keyof typeof plans;

// Paddle webhook MUST receive the raw request body for signature verification.
app.post(
  "/billing/webhook",
  express.raw({ type: "application/json" }),
  async (req: Request, res: Response) => {
    const signature = (req.headers["paddle-signature"] as string) || "";
    const secret = process.env.PADDLE_WEBHOOK_SECRET || "";

    if (!secret) {
      console.error("PADDLE_WEBHOOK_SECRET is not configured");
      return res.status(500).send("Webhook is not configured");
    }

    try {
      const rawBody = Buffer.isBuffer(req.body)
        ? req.body.toString("utf8")
        : String(req.body ?? "");
      const eventData = await paddle.webhooks.unmarshal(
        rawBody,
        secret,
        signature,
      );
      console.log("Webhook received:", eventData.eventType);

      // Persist subscription state so a completed checkout actually grants access —
      // previously this handler verified the signature and logged the event type but
      // never wrote anything to the billing store, so paying customers never got
      // marked Pro. `owner` (the GitHub login) travels in customData, set when the
      // checkout was opened in /subscribe; fall back to the stored customer->owner
      // mapping for events that don't carry customData (e.g. some renewal events).
      if (eventData.eventType.startsWith("subscription.")) {
        const sub = eventData.data as {
          id: string;
          status: string;
          customerId: string;
          customData?: { githubOwner?: string; plan?: string } | null;
        };

        let owner = sub.customData?.githubOwner;
        if (!owner) {
          owner = (await getOwnerForCustomer(sub.customerId)) || undefined;
        }

        if (owner) {
          await setProStatus({
            owner,
            plan: sub.customData?.plan || "pro",
            paddleCustomerId: sub.customerId,
            paddleSubscriptionId: sub.id,
            status: sub.status,
            updatedAt: new Date().toISOString(),
          });
        } else {
          // Not fatal to the webhook (still 200, so Paddle doesn't retry forever) —
          // but this customer's Pro status silently won't update until they check out
          // again with customData intact. Loud in the logs on purpose.
          console.error(
            `${eventData.eventType}: could not resolve a GitHub owner for customer ${sub.customerId} — Pro status NOT updated. ` +
              `customData was ${sub.customData ? JSON.stringify(sub.customData) : "missing"}.`
          );
        }
      }

      return res.status(200).send("OK");
    } catch (err) {
      console.error("Webhook error:", err);
      return res.status(400).send("Invalid Signature");
    }
  },
);

// GitHub webhook MUST receive the raw request body for HMAC signature verification —
// same reasoning as the Paddle webhook above, registered before express.json() for
// the same reason: JSON.stringify(JSON.parse(body)) is not guaranteed to byte-match
// what GitHub actually signed.
app.post(
  "/api/github/webhooks",
  express.raw({ type: "application/json" }),
  handlePullRequestWebhook,
);

app.use(express.json());

// Static assets referenced by index.html (logo, favicons, og:image) — the landing
// page's SEO meta tags point at /assets/*, so these must actually resolve.
app.use("/assets", express.static(path.join(__dirname, "..", "assets")));

app.get("/robots.txt", (_req: Request, res: Response) => {
  res.type("text/plain").sendFile(path.join(__dirname, "..", "robots.txt"));
});

app.get("/sitemap.xml", (_req: Request, res: Response) => {
  res.type("application/xml").sendFile(path.join(__dirname, "..", "sitemap.xml"));
});

app.get("/site.webmanifest", (_req: Request, res: Response) => {
  res.type("application/manifest+json").sendFile(path.join(__dirname, "..", "site.webmanifest"));
});

// Serve the landing page at the domain root. Paddle's domain-approval review checks
// the root URL you submit (e.g. https://warden-ci-dvk5.onrender.com/) for links to
// terms/privacy/refund policy — without this route, that URL 404'd with "Cannot GET /"
// and Paddle's reviewer would have no way to find those links at all.
app.get("/", (_req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, "..", "index.html"));
});

app.get("/details", (_req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, "..", "index.html"));
});

/**
 * Renders TERMS.md / PRIVACY.md as a plain readable page. These MUST be reachable —
 * Paddle's domain-approval process requires your site to link through to (or contain)
 * terms of service, a privacy notice, and a refund policy. Without these routes, the
 * footer links on the landing page 404, which is a likely cause of approval rejection.
 */
function legalPageHtml(title: string, filename: string): string {
  let content: string;
  try {
    content = readFileSync(path.join(__dirname, "..", filename), "utf-8");
  } catch {
    content = `Could not load ${filename}. Make sure it's deployed alongside the app.`;
  }
  const escaped = content
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title} — Warden CI</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; max-width: 680px; margin: 0 auto; padding: 48px 24px; color: #1a1a1a; }
  pre { white-space: pre-wrap; font-family: inherit; line-height: 1.6; }
  a { color: #1a1a1a; }
</style>
</head>
<body>
  <p><a href="/details">← Warden CI</a></p>
  <pre>${escaped}</pre>
</body>
</html>`;
}

app.get("/terms", (_req: Request, res: Response) => {
  res.type("html").send(legalPageHtml("Terms of Service", "TERMS.md"));
});

app.get("/privacy", (_req: Request, res: Response) => {
  res.type("html").send(legalPageHtml("Privacy Policy", "PRIVACY.md"));
});
app.get("/refund", (_req: Request, res: Response) => {
  res.type("html").send(legalPageHtml("Refund Policy", "REFUND.md"));
});

app.get("/subscribe", (req: Request, res: Response) => {
  const owner = String(req.query.owner || "user");
  const requestedPlan = String(req.query.plan || "pro").toLowerCase() as PlanKey;
  const selectedPlan: PlanKey = requestedPlan in plans ? requestedPlan : "pro";
  const clientToken = process.env.PADDLE_CLIENT_TOKEN || "";
  const environment = process.env.PADDLE_ENVIRONMENT === "production" ? "production" : "sandbox";
  // Flip this env var to "true" the moment Paddle approves the domain — no redeploy
  // of any other logic needed, checkout switches back on immediately. Until then,
  // /subscribe collects emails instead of showing buttons that would fail at Paddle.
  const checkoutEnabled = process.env.PADDLE_CHECKOUT_ENABLED === "true";

  const planCards = (Object.keys(plans) as PlanKey[])
    .map((key) => {
      const plan = plans[key];
      const selected = key === selectedPlan;
      const priceIdConfigured = Boolean(plan.priceId());
      const features = plan.features
        .map((feature) => `<li>✓ ${escapeHtml(feature)}</li>`)
        .join("");
      const canCheckout = checkoutEnabled && priceIdConfigured && clientToken;

      return `
        <article class="plan ${selected ? "selected" : ""}" ${checkoutEnabled ? "" : `data-plan-card="${key}"`}>
          <div>
            <div class="plan-title-row">
              <h2>${escapeHtml(plan.name)}</h2>
              <span class="badge">Selected</span>
            </div>
            <p class="description">${escapeHtml(plan.description)}</p>
            <div class="price">${escapeHtml(plan.price)} <span>/ month</span></div>
            <ul>${features}</ul>
          </div>
          ${
            checkoutEnabled
              ? `<button
            class="checkout ${selected ? "primary" : "secondary"}"
            data-plan="${key}"
            ${canCheckout ? "" : "disabled"}
          >
            ${canCheckout ? `Choose ${escapeHtml(plan.name)}` : "Not configured"}
          </button>`
              : `<div class="pick-hint">${selected ? "✓ Selected" : "Click to select"}</div>`
          }
        </article>`;
    })
    .join("\n");

  const configurationWarning =
    checkoutEnabled && !clientToken
      ? `<div class="warning">Paddle checkout is not configured: <code>PADDLE_CLIENT_TOKEN</code> is missing on the server.</div>`
      : "";

  const waitlistSection = !checkoutEnabled
    ? `
    <section class="waitlist-section">
      <div class="warning" style="background:#1e1b4b;border-color:#4338ca;color:#c7d2fe;">Paid plans aren't open yet — pick a plan above, then leave your email and we'll send you a signup link the moment they go live.</div>
      <form id="waitlist-form" class="waitlist-form" onsubmit="return submitWaitlist(event)">
        <input type="email" name="email" required placeholder="you@example.com" class="waitlist-input" />
        <button type="submit" class="checkout primary" style="width:auto;padding:13px 24px;">Notify me — <span id="waitlist-plan-label">${escapeHtml(plans[selectedPlan].name)}</span></button>
      </form>
    </section>`
    : "";

  res.type("html").send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Warden CI — Choose a plan</title>

  <!-- Google Analytics (GA4) -->
  <script async src="https://www.googletagmanager.com/gtag/js?id=G-XBE18HJZ5V"></script>
  <script>
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    gtag('js', new Date());
    gtag('config', 'G-XBE18HJZ5V');
  </script>

  <script src="https://cdn.paddle.com/paddle/v2/paddle.js"></script>
  <style>
    *{box-sizing:border-box}body{margin:0;background:#020617;color:#f8fafc;font-family:Inter,ui-sans-serif,system-ui,-apple-system,sans-serif}.wrap{max-width:1120px;margin:0 auto;padding:56px 20px 72px}.eyebrow{color:#818cf8;font-weight:700;text-transform:uppercase;letter-spacing:.12em;font-size:12px;text-align:center}.title{text-align:center;font-size:42px;line-height:1.1;margin:10px 0}.subtitle{text-align:center;color:#94a3b8;max-width:680px;margin:0 auto 34px}.plans{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px}.plan{background:#0f172a;border:1px solid #1e293b;border-radius:20px;padding:26px;min-height:460px;display:flex;flex-direction:column;justify-content:space-between}.plan[data-plan-card]{cursor:pointer;transition:border-color .15s,box-shadow .15s}.plan[data-plan-card]:hover{border-color:#4338ca}.plan.selected{border-color:#6366f1;box-shadow:0 0 0 1px #6366f1}.plan-title-row{display:flex;align-items:center;justify-content:space-between;gap:12px}.plan h2{font-size:24px;margin:0}.badge{display:none;font-size:11px;padding:5px 8px;border-radius:999px;background:#312e81;color:#c7d2fe;white-space:nowrap}.plan.selected .badge{display:inline-block}.description{color:#94a3b8;min-height:48px;line-height:1.5}.price{font-size:36px;font-weight:800;margin:22px 0}.price span{font-size:13px;font-weight:400;color:#64748b}.plan ul{list-style:none;padding:0;margin:0}.plan li{color:#cbd5e1;margin:12px 0;font-size:14px}.pick-hint{margin-top:20px;text-align:center;font-size:13px;font-weight:600;color:#64748b}.plan.selected .pick-hint{color:#818cf8}.checkout{width:100%;border:0;border-radius:12px;padding:13px 16px;font-weight:700;cursor:pointer;font-size:15px}.checkout.primary{background:#4f46e5;color:white}.checkout.primary:hover{background:#6366f1}.checkout.secondary{background:#1e293b;color:white}.checkout.secondary:hover{background:#334155}.checkout:disabled{opacity:.5;cursor:not-allowed}.warning{background:#451a03;border:1px solid #92400e;color:#fed7aa;padding:14px 16px;border-radius:12px;margin:0 auto 22px;max-width:800px}.status{text-align:center;min-height:24px;color:#94a3b8;margin-top:22px}.back{text-align:center;margin-top:26px}.back a{color:#818cf8;text-decoration:none}.waitlist-section{margin-top:48px;padding-top:40px;border-top:1px solid #1e293b}.waitlist-form{display:flex;gap:10px;justify-content:center;max-width:460px;margin:0 auto;flex-wrap:wrap}.waitlist-input{flex:1;min-width:220px;padding:12px 14px;border-radius:10px;border:1px solid #1e293b;background:#0f172a;color:#f8fafc;font-size:14px}@media(max-width:800px){.plans{grid-template-columns:1fr}.title{font-size:34px}}
  </style>
</head>
<body>
  <main class="wrap">
    <div class="eyebrow">Warden CI</div>
    <h1 class="title">Protect your codebase</h1>
    <p class="subtitle">Choose the plan that fits your repository or engineering team. Checkout is powered securely by Paddle.</p>
    ${configurationWarning}
    <section class="plans">${planCards}</section>
    ${waitlistSection}
    <div id="status" class="status"></div>
    <div class="back"><a href="/details">← Back to Warden CI</a></div>
  </main>

  <script>
    const clientToken = ${jsString(clientToken)};
    const environment = ${jsString(environment)};
    const owner = ${jsString(owner)};
    const checkoutEnabled = ${checkoutEnabled ? "true" : "false"};
    const priceIds = ${JSON.stringify(Object.fromEntries((Object.keys(plans) as PlanKey[]).map((key) => [key, plans[key].priceId()]))) };
    const planNames = ${JSON.stringify(Object.fromEntries((Object.keys(plans) as PlanKey[]).map((key) => [key, plans[key].name])))};
    let selectedPlan = ${jsString(selectedPlan)};
    const statusEl = document.getElementById('status');

    if (checkoutEnabled && clientToken) {
      try {
        // MUST run before Initialize(). If this call is skipped, Paddle.js silently
        // defaults to "production" — so a sandbox client token + sandbox price IDs end
        // up hitting Paddle's live API, which is what produces the generic "Something
        // went wrong" overlay error with no useful message.
        Paddle.Environment.set(environment);
        Paddle.Initialize({ token: clientToken });
      } catch (error) {
        console.error('Paddle initialization failed:', error);
        statusEl.textContent = 'Paddle could not be initialized. Check the client token and environment.';
      }
    }

    if (checkoutEnabled) {
      document.querySelectorAll('.checkout[data-plan]').forEach((button) => {
        button.addEventListener('click', () => {
          const plan = button.dataset.plan;
          const priceId = priceIds[plan];
          if (!priceId) {
            statusEl.textContent = 'This plan is not configured yet. Please contact the Warden CI administrator.';
            return;
          }
          if (!clientToken) {
            statusEl.textContent = 'Paddle is not configured on this deployment.';
            return;
          }

          statusEl.textContent = 'Opening secure checkout…';
          if (typeof gtag === 'function') {
            gtag('event', 'begin_checkout', { plan: plan });
          }
          try {
            Paddle.Checkout.open({
              items: [{ priceId, quantity: 1 }],
              customData: { githubOwner: owner, plan },
              settings: { displayMode: 'overlay', theme: 'dark' },
            });
          } catch (error) {
            console.error('Paddle checkout failed:', error);
            statusEl.textContent = 'Paddle checkout could not be opened. Verify that the client token and selected price belong to the same Paddle environment.';
          }
        });
      });
    } else {
      // Waitlist mode: the whole card is clickable, not just a button inside it —
      // clicking anywhere on a plan selects it and updates the "Notify me" label
      // so the email gets saved against whichever plan was actually picked.
      document.querySelectorAll('.plan[data-plan-card]').forEach((card) => {
        card.addEventListener('click', () => {
          selectedPlan = card.dataset.planCard;
          document.querySelectorAll('.plan[data-plan-card]').forEach((c) => {
            c.classList.toggle('selected', c === card);
          });
          document.getElementById('waitlist-plan-label').textContent = planNames[selectedPlan];
        });
      });
    }

    async function submitWaitlist(evt) {
      evt.preventDefault();
      const form = evt.target;
      const email = form.email.value;
      const plan = selectedPlan;
      statusEl.textContent = 'Saving…';
      try {
        const res = await fetch('/waitlist/join', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, plan, owner }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || ('Request failed (' + res.status + ')'));
        if (typeof gtag === 'function') {
          gtag('event', 'join_waitlist', { plan: plan });
        }
        statusEl.textContent = "You're on the list for " + planNames[plan] + " — we'll email you the moment paid plans go live.";
        form.reset();
      } catch (error) {
        console.error('Waitlist signup failed:', error);
        statusEl.textContent = error.message || 'Something went wrong saving your email — please try again in a moment.';
      }
      return false;
    }
  </script>
</body>
</html>`);
});

app.post("/waitlist/join", async (req: Request, res: Response) => {
  const email = String(req.body?.email || "").trim();
  const plan = String(req.body?.plan || "pro").trim();
  const owner = String(req.body?.owner || "").trim();

  if (!email || !email.includes("@")) {
    return res.status(400).json({ ok: false, error: "A valid email is required." });
  }

  try {
    await addToWaitlist({ email, plan, owner, addedAt: new Date().toISOString() });
    return res.status(200).json({ ok: true });
  } catch (err) {
    // Log the full detail server-side (check Render logs), but also return a short
    // version to the client — generic "something went wrong" with no cause left
    // people (and me) unable to tell a missing env var apart from a real outage.
    console.error("Waitlist signup error:", err);
    const detail = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ ok: false, error: `Could not save signup: ${detail}` });
  }
});

/**
 * Plain-text export of collected waitlist emails, protected by a shared secret in the
 * query string (?key=...) rather than a login system — this is meant for a solo
 * founder to pull a CSV-ish list when it's time to email everyone, not a full admin
 * panel. Set WAITLIST_ADMIN_KEY in your env to something long/random before using this.
 */
app.get("/admin/waitlist", async (req: Request, res: Response) => {
  const adminKey = process.env.WAITLIST_ADMIN_KEY;
  if (!adminKey || req.query.key !== adminKey) {
    return res.status(404).send("Not found");
  }
  try {
    const entries = await getWaitlist();
    const lines = entries
      .sort((a, b) => a.addedAt.localeCompare(b.addedAt))
      .map((e) => `${e.email}\t${e.plan}\t${e.owner}\t${e.addedAt}`);
    res
      .type("text/plain")
      .send(`email\tplan\towner\taddedAt\n${lines.join("\n")}\n\n${entries.length} total signups.`);
  } catch (err) {
    console.error("Waitlist export error:", err);
    res.status(500).send("Could not load waitlist.");
  }
});

// Debug fields (rawCheckoutEnabledValue / rawCheckoutEnabledLength) show exactly what
// the server sees for PADDLE_CHECKOUT_ENABLED — no guessing whether a typo, stray
// whitespace, or wrong casing is why /subscribe is still showing the waitlist view.
// A value like "true " (trailing space) looks identical to "true" in most UI text
// boxes but has length 5, not 4, and fails the strict === "true" check silently.
app.get("/health", (_req: Request, res: Response) => {
  const rawFlag = process.env.PADDLE_CHECKOUT_ENABLED;
  res.json({
    ok: true,
    paddleEnvironment: process.env.PADDLE_ENVIRONMENT === "production" ? "production" : "sandbox",
    paddleClientTokenConfigured: Boolean(process.env.PADDLE_CLIENT_TOKEN),
    checkoutEnabled: rawFlag === "true",
    rawCheckoutEnabledValue: rawFlag ?? null,
    rawCheckoutEnabledLength: rawFlag ? rawFlag.length : 0,
    plans: {
      pro: Boolean(process.env.PADDLE_PRICE_PRO),
      team: Boolean(process.env.PADDLE_PRICE_TEAM),
      enterprise: Boolean(process.env.PADDLE_PRICE_ENTERPRISE),
    },
  });
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
