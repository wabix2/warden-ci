"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const path_1 = __importDefault(require("path"));
const fs_1 = require("fs");
const node_crypto_1 = require("node:crypto");
const drizzle_orm_1 = require("drizzle-orm");
const store_1 = require("./billing/store");
const scan_1 = require("./scan");
const enterprise_1 = require("./scan/enterprise");
const db_1 = require("./db");
const schema_1 = require("./db/schema");
const webhookHandler_1 = require("./github/webhookHandler");
const redis_1 = require("./lib/redis");
const popularPackageRefresh_1 = require("./scan/popularPackageRefresh");
const corpusLog_1 = require("./telemetry/corpusLog");
const runAccess_1 = require("./auth/runAccess");
const app = (0, express_1.default)();
const PORT = Number(process.env.PORT || 3000);
const OAUTH_STATE_COOKIE = "warden_oauth_state";
const SESSION_COOKIE = "warden_session";
const SESSION_TTL_SECONDS = 60 * 60 * 8;
function cookieValue(req, name) {
    const header = req.headers.cookie ?? "";
    return header.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1);
}
function secureCookie(req) {
    return req.secure || req.headers["x-forwarded-proto"] === "https" ? "; Secure" : "";
}
async function githubJson(url, token) {
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" } });
    if (!response.ok)
        throw new Error(`GitHub OAuth request failed (${response.status})`);
    return await response.json();
}
async function dashboardInstallation(req, installationId) {
    const sessionId = cookieValue(req, SESSION_COOKIE);
    if (!sessionId)
        return null;
    const token = await (0, redis_1.getRedisClient)().get(`warden:oauth:session:${sessionId}`);
    if (!token)
        return null;
    // The settings mutate installation-wide telemetry behavior. GitHub's OAuth
    // repository listing proves repository read access, not installation-wide
    // administrative authority, so do not grant broader access on that basis.
    // This remains fail-closed until a documented stronger proof is available.
    return false;
}
// Fail loud at boot, not silently on the first user's request — if this prints on
// deploy, the waitlist (and Pro-status checks) will fail until it's fixed.
if (!process.env.UPSTASH_REDIS_REST_URL?.trim() || !process.env.UPSTASH_REDIS_REST_TOKEN?.trim()) {
    console.error("WARNING: UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN missing or empty — " +
        "waitlist signups and Pro-status checks will fail until these are set correctly.");
}
if (!process.env.GITHUB_APP_ID?.trim() ||
    !process.env.GITHUB_PRIVATE_KEY?.trim() ||
    !process.env.GITHUB_WEBHOOK_SECRET?.trim()) {
    console.error("WARNING: GITHUB_APP_ID / GITHUB_PRIVATE_KEY / GITHUB_WEBHOOK_SECRET missing or empty — " +
        "PR scanning will not work until these are set. This is the core product; billing without a working scanner has nothing to sell.");
}
function escapeHtml(value) {
    return value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}
function jsString(value) {
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
        checkoutUrl: () => process.env.GUMROAD_CHECKOUT_PRO || "",
        productId: () => process.env.GUMROAD_PRODUCT_PRO || "",
    },
    team: {
        name: "Team",
        price: "$49",
        description: "Coming later — organization controls are not available yet.",
        features: [
            "Everything in Pro",
            "Unlimited team members",
            "Team-wide repository protection",
            "Centralized security visibility",
            "Priority support",
        ],
        checkoutUrl: () => process.env.GUMROAD_CHECKOUT_TEAM || "",
        productId: () => process.env.GUMROAD_PRODUCT_TEAM || "",
    },
    enterprise: {
        name: "Enterprise",
        price: "$149",
        description: "Coming later — custom governance is not available yet.",
        features: [
            "Everything in Team",
            "Organization-wide protection",
            "Advanced controls",
            "Enterprise support",
            "Custom security requirements",
        ],
        checkoutUrl: () => process.env.GUMROAD_CHECKOUT_ENTERPRISE || "",
        productId: () => process.env.GUMROAD_PRODUCT_ENTERPRISE || "",
    },
};
// Gumroad sends form-encoded ping notifications. Keep this route before express.json().
app.post("/billing/webhook", express_1.default.urlencoded({ extended: false }), async (req, res) => {
    const secret = process.env.GUMROAD_WEBHOOK_SECRET || "";
    if (!secret)
        return res.status(500).send("Webhook is not configured");
    const provided = String(req.body?.license_key || req.body?.custom_fields || "");
    const expected = (0, node_crypto_1.createHmac)("sha256", secret).update(provided).digest("hex");
    const signature = String(req.headers["x-gumroad-signature"] || req.body?.signature || "");
    if (!signature || signature.length !== expected.length || !(0, node_crypto_1.timingSafeEqual)(Buffer.from(signature), Buffer.from(expected))) {
        return res.status(401).send("Invalid signature");
    }
    const saleId = String(req.body?.sale_id || req.body?.id || "").trim();
    const subscriptionId = String(req.body?.subscription_id || "").trim();
    const productId = String(req.body?.product_id || "").trim();
    const productMap = Object.fromEntries(Object.keys(plans).map((key) => [plans[key].productId(), key]));
    const plan = productMap[productId];
    if (plan && plan !== "pro")
        return res.status(400).send("This tier is not available yet");
    if (!saleId || !plan)
        return res.status(400).send("Unknown product or malformed sale");
    const fields = typeof req.body?.custom_fields === "string" ? JSON.parse(req.body.custom_fields) : req.body?.custom_fields || {};
    const owner = String(fields.githubOwner || req.body?.github_owner || "").trim().toLowerCase();
    const existingOwner = await (0, store_1.getOwnerForSale)(saleId);
    const resolvedOwner = owner || existingOwner;
    if (!resolvedOwner)
        return res.status(200).send("Ignored: owner unavailable");
    const refunded = String(req.body?.refunded || "false") === "true";
    const canceled = String(req.body?.subscription_cancelled_at || "").trim().length > 0;
    await (0, store_1.setProStatus)({
        owner: resolvedOwner,
        plan,
        gumroadProductId: productId,
        gumroadSaleId: saleId,
        gumroadSubscriptionId: subscriptionId || undefined,
        status: refunded ? "refunded" : canceled ? "canceled" : "active",
        refundedAt: refunded ? new Date().toISOString() : undefined,
        canceledAt: canceled ? new Date().toISOString() : undefined,
        updatedAt: new Date().toISOString(),
    });
    return res.status(200).send("OK");
});
// GitHub webhook MUST receive the raw request body for HMAC signature verification —
// same reasoning as the Gumroad webhook above, registered before express.json() for
// the same reason: JSON.stringify(JSON.parse(body)) is not guaranteed to byte-match
// what GitHub actually signed.
app.post("/api/github/webhooks", express_1.default.raw({ type: "application/json" }), webhookHandler_1.handlePullRequestWebhook);
app.use(express_1.default.json());
// Static assets referenced by index.html (logo, favicons, og:image) — the landing
// page's SEO meta tags point at /assets/*, so these must actually resolve.
app.use("/assets", express_1.default.static(path_1.default.join(__dirname, "..", "assets")));
app.get("/robots.txt", (_req, res) => {
    res.type("text/plain").sendFile(path_1.default.join(__dirname, "..", "robots.txt"));
});
app.get("/sitemap.xml", (_req, res) => {
    res.type("application/xml").sendFile(path_1.default.join(__dirname, "..", "sitemap.xml"));
});
app.get("/site.webmanifest", (_req, res) => {
    res.type("application/manifest+json").sendFile(path_1.default.join(__dirname, "..", "site.webmanifest"));
});
// Serve the landing page at the domain root. Gumroad's domain-approval review checks
// the root URL you submit (e.g. https://warden-ci-dvk5.onrender.com/) for links to
// terms/privacy/refund policy — without this route, that URL 404'd with "Cannot GET /"
// and Gumroad's reviewer would have no way to find those links at all.
app.get("/", (_req, res) => {
    res.sendFile(path_1.default.join(__dirname, "..", "index.html"));
});
app.get("/api/runs/:runId", async (req, res) => {
    const runId = String(req.params.runId || "");
    if (!(0, runAccess_1.isUuid)(runId))
        return res.status(404).json({ ok: false, error: "Run not found" });
    try {
        const access = await (0, runAccess_1.authorizeRunAccess)(req, runId);
        if (access.kind === "unauthenticated")
            return res.status(401).json({ ok: false, error: "GitHub login required" });
        if (access.kind === "not_found")
            return res.status(404).json({ ok: false, error: "Run not found" });
        if (access.kind === "forbidden")
            return res.status(403).json({ ok: false, error: "Run access is not authorized" });
        if (!db_1.db)
            return res.status(503).json({ ok: false, error: "Database unavailable" });
        const repository = (await db_1.db.select({ fullName: schema_1.repositories.fullName, defaultBranch: schema_1.repositories.defaultBranch })
            .from(schema_1.repositories).innerJoin(schema_1.scanRuns, (0, drizzle_orm_1.eq)(schema_1.scanRuns.repositoryId, schema_1.repositories.id)).where((0, drizzle_orm_1.eq)(schema_1.scanRuns.id, runId)).limit(1))[0];
        const reportFindings = await db_1.db.select({
            id: schema_1.findings.id, severity: schema_1.findings.severity, category: schema_1.findings.category, title: schema_1.findings.title,
            message: schema_1.findings.message, filePath: schema_1.findings.filePath, lineNumber: schema_1.findings.lineNumber,
            remediation: schema_1.findings.remediation, status: schema_1.findings.status, createdAt: schema_1.findings.createdAt,
        }).from(schema_1.findings).where((0, drizzle_orm_1.eq)(schema_1.findings.scanRunId, runId));
        return res.json({ ok: true, run: {
                id: access.run.id, scanTimestamp: access.run.completedAt || access.run.startedAt || access.run.createdAt,
                createdAt: access.run.createdAt, pullRequestNumber: access.run.pullRequestNumber,
                commitSha: access.run.commitSha, status: access.run.status, verdict: access.run.verdict,
                findingsCount: access.run.findingsCount, repository: repository?.fullName || null,
                defaultBranch: repository?.defaultBranch || null,
                findings: reportFindings,
            } });
    }
    catch (error) {
        console.error("Run report access failed:", error);
        return res.status(502).json({ ok: false, error: "Could not load run report" });
    }
});
app.post("/api/runs/:runId/findings/:findingId/fix", async (req, res) => {
    const runId = String(req.params.runId || "");
    const findingId = String(req.params.findingId || "");
    if (!(0, runAccess_1.isUuid)(runId) || !(0, runAccess_1.isUuid)(findingId))
        return res.status(404).json({ ok: false, error: "Finding not found" });
    try {
        const access = await (0, runAccess_1.authorizeRunAccess)(req, runId);
        if (access.kind === "unauthenticated")
            return res.status(401).json({ ok: false, error: "GitHub login required" });
        if (access.kind === "not_found")
            return res.status(404).json({ ok: false, error: "Run not found" });
        if (access.kind === "forbidden")
            return res.status(403).json({ ok: false, error: "Remediation is not authorized" });
        if (!db_1.db)
            return res.status(503).json({ ok: false, error: "Database unavailable" });
        const finding = (await db_1.db.select({ id: schema_1.findings.id }).from(schema_1.findings).where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.findings.id, findingId), (0, drizzle_orm_1.eq)(schema_1.findings.scanRunId, runId))).limit(1))[0];
        if (!finding)
            return res.status(404).json({ ok: false, error: "Finding not found" });
        // Current findings do not yet persist advisory IDs, affected ranges, or the
        // exact manifest content required for a safe write. Never guess or mutate GitHub.
        return res.status(409).json({ ok: false, status: "remediation_unavailable", error: "This finding lacks the advisory and manifest metadata required for safe remediation" });
    }
    catch (error) {
        console.error("Remediation request failed:", error);
        return res.status(502).json({ ok: false, error: "Could not evaluate remediation request" });
    }
});
app.get("/details", (req, res) => {
    if (!req.query.runId)
        return res.sendFile(path_1.default.join(__dirname, "..", "index.html"));
    res.sendFile(path_1.default.join(__dirname, "..", "report.html"));
});
app.get("/dashboard", (_req, res) => {
    res.sendFile(path_1.default.join(__dirname, "..", "dashboard.html"));
});
app.get("/auth/github", (_req, res) => {
    const clientId = process.env.GITHUB_OAUTH_CLIENT_ID;
    if (!clientId)
        return res.status(503).send("GitHub OAuth is not configured");
    const state = (0, node_crypto_1.randomBytes)(24).toString("hex");
    const callback = `${process.env.PUBLIC_BASE_URL || `${_req.protocol}://${_req.get("host")}`}/auth/github/callback`;
    void (0, redis_1.getRedisClient)().set(`warden:oauth:state:${state}`, "1", { ex: 600 });
    res.setHeader("Set-Cookie", `${OAUTH_STATE_COOKIE}=${state}; HttpOnly; SameSite=Lax; Path=/${secureCookie(_req)}`);
    res.redirect(`https://github.com/login/oauth/authorize?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(callback)}&scope=`);
});
app.get("/auth/github/callback", async (req, res) => {
    const state = String(req.query.state || "");
    const expected = cookieValue(req, OAUTH_STATE_COOKIE);
    if (!state || !expected || state !== expected)
        return res.status(403).send("Invalid OAuth state");
    const stateKey = `warden:oauth:state:${state}`;
    const redis = (0, redis_1.getRedisClient)();
    const stateValue = await redis.get(stateKey);
    if (stateValue !== "1")
        return res.status(403).send("Invalid OAuth state");
    // Consume the state before exchanging the code. A callback replay must fail
    // even if the first request has not finished creating its session yet.
    await redis.del(stateKey);
    if (!req.query.code)
        return res.status(400).send("Missing OAuth code");
    try {
        const response = await fetch("https://github.com/login/oauth/access_token", { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify({ client_id: process.env.GITHUB_OAUTH_CLIENT_ID, client_secret: process.env.GITHUB_OAUTH_CLIENT_SECRET, code: String(req.query.code || "") }) });
        const data = await response.json();
        if (!data.access_token)
            return res.status(401).send("GitHub OAuth failed");
        const sessionId = (0, node_crypto_1.randomBytes)(32).toString("hex");
        await (0, redis_1.getRedisClient)().set(`warden:oauth:session:${sessionId}`, data.access_token, { ex: SESSION_TTL_SECONDS });
        res.setHeader("Set-Cookie", `${SESSION_COOKIE}=${sessionId}; HttpOnly; SameSite=Lax; Path=/${secureCookie(req)}`);
        return res.redirect("/dashboard");
    }
    catch (error) {
        console.error("GitHub OAuth callback failed:", error);
        return res.status(502).send("GitHub OAuth is unavailable");
    }
});
app.get("/api/telemetry/settings", async (req, res) => {
    const installationId = Number(req.query.installationId);
    if (!Number.isSafeInteger(installationId) || installationId <= 0)
        return res.status(400).json({ ok: false, error: "Invalid installation ID" });
    try {
        const authorized = await dashboardInstallation(req, installationId);
        if (authorized === null)
            return res.status(401).json({ ok: false, error: "GitHub login required" });
        if (!authorized)
            return res.status(403).json({ ok: false, error: "Installation is not authorized for this GitHub account" });
        const redis = (0, redis_1.getRedisClient)();
        return res.json({ ok: true, publicOptedOut: (await redis.get(`warden:telemetry:optout:${installationId}`)) === "1", privateOptedIn: (await redis.get(`warden:telemetry:optout:private:${installationId}`)) === "enabled" });
    }
    catch (error) {
        console.error("Telemetry settings read failed:", error);
        return res.status(502).json({ ok: false, error: "Could not verify GitHub installation" });
    }
});
app.put("/api/telemetry/settings", async (req, res) => {
    const installationId = Number(req.body?.installationId);
    if (!Number.isSafeInteger(installationId) || installationId <= 0)
        return res.status(400).json({ ok: false, error: "Invalid installation ID" });
    try {
        const authorized = await dashboardInstallation(req, installationId);
        if (authorized === null)
            return res.status(401).json({ ok: false, error: "GitHub login required" });
        if (!authorized)
            return res.status(403).json({ ok: false, error: "Installation is not authorized for this GitHub account" });
        if (typeof req.body.publicOptedOut === "boolean")
            await (0, corpusLog_1.setInstallationCorpusOptOut)(installationId, req.body.publicOptedOut);
        if (typeof req.body.privateOptedIn === "boolean")
            await (0, corpusLog_1.setPrivateCorpusOptIn)(installationId, req.body.privateOptedIn);
        return res.json({ ok: true });
    }
    catch (error) {
        console.error("Telemetry settings write failed:", error);
        return res.status(502).json({ ok: false, error: "Could not update telemetry settings" });
    }
});
app.get("/api/dashboard/summary", async (req, res) => {
    const token = String(req.headers.authorization || "").replace(/^Bearer\\s+/i, "");
    if (!process.env.WARDEN_API_TOKEN || token !== process.env.WARDEN_API_TOKEN)
        return res.status(401).json({ ok: false, error: "Unauthorized" });
    if (!db_1.db)
        return res.status(503).json({ ok: false, error: "Database unavailable" });
    const limit = Math.min(Math.max(Number(req.query.limit || 25), 1), 100);
    try {
        const runs = await db_1.db.select().from(schema_1.scanRuns).limit(limit);
        const recentFindings = await db_1.db.select().from(schema_1.findings).limit(limit);
        const audit = await db_1.db.select().from(schema_1.auditEvents).limit(limit);
        return res.json({ ok: true, generatedAt: new Date().toISOString(), summary: { scans: runs.length, blocked: runs.filter((run) => run.verdict === "failure").length, findings: recentFindings.length }, runs, findings: recentFindings, audit });
    }
    catch (error) {
        console.error("Dashboard summary error:", error);
        return res.status(500).json({ ok: false, error: "Could not load dashboard data" });
    }
});
/**
 * Renders TERMS.md / PRIVACY.md as a plain readable page. These MUST be reachable —
 * Gumroad's domain-approval process requires your site to link through to (or contain)
 * terms of service, a privacy notice, and a refund policy. Without these routes, the
 * footer links on the landing page 404, which is a likely cause of approval rejection.
 */
function legalPageHtml(title, filename) {
    let content;
    try {
        content = (0, fs_1.readFileSync)(path_1.default.join(__dirname, "..", filename), "utf-8");
    }
    catch {
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
app.get("/terms", (_req, res) => {
    res.type("html").send(legalPageHtml("Terms of Service", "TERMS.md"));
});
app.get("/privacy", (_req, res) => {
    res.type("html").send(legalPageHtml("Privacy Policy", "PRIVACY.md"));
});
app.get("/refund", (_req, res) => {
    res.type("html").send(legalPageHtml("Refund Policy", "REFUND.md"));
});
app.get("/subscribe", (req, res) => {
    const owner = String(req.query.owner || "user");
    const requestedPlan = String(req.query.plan || "pro").toLowerCase();
    const selectedPlan = requestedPlan in plans ? requestedPlan : "pro";
    const checkoutEnabled = process.env.GUMROAD_CHECKOUT_ENABLED !== "false";
    const visiblePlans = Object.keys(plans).filter((key) => key === "pro" || Boolean(plans[key].checkoutUrl()));
    const planCards = visiblePlans
        .map((key) => {
        const plan = plans[key];
        const selected = key === selectedPlan;
        const checkoutConfigured = Boolean(plan.checkoutUrl());
        const features = plan.features
            .map((feature) => `<li>✓ ${escapeHtml(feature)}</li>`)
            .join("");
        const canCheckout = checkoutEnabled && checkoutConfigured;
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
          ${checkoutEnabled
            ? `<button
            class="checkout ${selected ? "primary" : "secondary"}"
            data-plan="${key}"
            ${canCheckout ? "" : "disabled"}
          >
            ${canCheckout ? `Choose ${escapeHtml(plan.name)}` : "Not configured"}
          </button>`
            : `<div class="pick-hint">${selected ? "✓ Selected" : "Click to select"}</div>`}
        </article>`;
    })
        .join("\n");
    const configurationWarning = checkoutEnabled && !plans.pro.checkoutUrl()
        ? `<div class="warning">Gumroad checkout is not fully configured: add the product checkout URLs to the server environment.</div>`
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

  <style>
    *{box-sizing:border-box}body{margin:0;background:#020617;color:#f8fafc;font-family:Inter,ui-sans-serif,system-ui,-apple-system,sans-serif}.wrap{max-width:1120px;margin:0 auto;padding:56px 20px 72px}.eyebrow{color:#818cf8;font-weight:700;text-transform:uppercase;letter-spacing:.12em;font-size:12px;text-align:center}.title{text-align:center;font-size:42px;line-height:1.1;margin:10px 0}.subtitle{text-align:center;color:#94a3b8;max-width:680px;margin:0 auto 34px}.plans{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px}.plan{background:#0f172a;border:1px solid #1e293b;border-radius:20px;padding:26px;min-height:460px;display:flex;flex-direction:column;justify-content:space-between}.plan[data-plan-card]{cursor:pointer;transition:border-color .15s,box-shadow .15s}.plan[data-plan-card]:hover{border-color:#4338ca}.plan.selected{border-color:#6366f1;box-shadow:0 0 0 1px #6366f1}.plan-title-row{display:flex;align-items:center;justify-content:space-between;gap:12px}.plan h2{font-size:24px;margin:0}.badge{display:none;font-size:11px;padding:5px 8px;border-radius:999px;background:#312e81;color:#c7d2fe;white-space:nowrap}.plan.selected .badge{display:inline-block}.description{color:#94a3b8;min-height:48px;line-height:1.5}.price{font-size:36px;font-weight:800;margin:22px 0}.price span{font-size:13px;font-weight:400;color:#64748b}.plan ul{list-style:none;padding:0;margin:0}.plan li{color:#cbd5e1;margin:12px 0;font-size:14px}.pick-hint{margin-top:20px;text-align:center;font-size:13px;font-weight:600;color:#64748b}.plan.selected .pick-hint{color:#818cf8}.checkout{width:100%;border:0;border-radius:12px;padding:13px 16px;font-weight:700;cursor:pointer;font-size:15px}.checkout.primary{background:#4f46e5;color:white}.checkout.primary:hover{background:#6366f1}.checkout.secondary{background:#1e293b;color:white}.checkout.secondary:hover{background:#334155}.checkout:disabled{opacity:.5;cursor:not-allowed}.warning{background:#451a03;border:1px solid #92400e;color:#fed7aa;padding:14px 16px;border-radius:12px;margin:0 auto 22px;max-width:800px}.status{text-align:center;min-height:24px;color:#94a3b8;margin-top:22px}.back{text-align:center;margin-top:26px}.back a{color:#818cf8;text-decoration:none}.waitlist-section{margin-top:48px;padding-top:40px;border-top:1px solid #1e293b}.waitlist-form{display:flex;gap:10px;justify-content:center;max-width:460px;margin:0 auto;flex-wrap:wrap}.waitlist-input{flex:1;min-width:220px;padding:12px 14px;border-radius:10px;border:1px solid #1e293b;background:#0f172a;color:#f8fafc;font-size:14px}@media(max-width:800px){.plans{grid-template-columns:1fr}.title{font-size:34px}}
  </style>
</head>
<body>
  <main class="wrap">
    <div class="eyebrow">Warden CI</div>
    <h1 class="title">Protect your codebase</h1>
    <p class="subtitle">Choose the plan that fits your repository or engineering team. Checkout is powered securely by Gumroad.</p>
    ${configurationWarning}
    <section class="plans">${planCards}</section>
    ${waitlistSection}
    <div id="status" class="status"></div>
    <div class="back"><a href="/details">← Back to Warden CI</a></div>
  </main>

  <script>
    const owner = ${jsString(owner)};
    const checkoutEnabled = ${checkoutEnabled ? "true" : "false"};
    const checkoutUrls = ${JSON.stringify(Object.fromEntries(Object.keys(plans).map((key) => [key, plans[key].checkoutUrl()])))};
    const planNames = ${JSON.stringify(Object.fromEntries(Object.keys(plans).map((key) => [key, plans[key].name])))};
    let selectedPlan = ${jsString(selectedPlan)};
    const statusEl = document.getElementById('status');

    if (checkoutEnabled) {
      document.querySelectorAll('.checkout[data-plan]').forEach((button) => {
        button.addEventListener('click', () => {
          const plan = button.dataset.plan;
          const checkoutUrl = checkoutUrls[plan];
          if (!checkoutUrl) {
            statusEl.textContent = 'This plan is not configured yet. Please contact the Warden CI administrator.';
            return;
          }
          if (typeof gtag === 'function') gtag('event', 'begin_checkout', { plan });
          const url = new URL(checkoutUrl);
          url.searchParams.set('github_owner', owner);
          url.searchParams.set('plan', plan);
          window.location.assign(url.toString());
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
app.post("/waitlist/join", async (req, res) => {
    const email = String(req.body?.email || "").trim();
    const plan = String(req.body?.plan || "pro").trim();
    const owner = String(req.body?.owner || "").trim();
    if (!email || !email.includes("@")) {
        return res.status(400).json({ ok: false, error: "A valid email is required." });
    }
    try {
        await (0, store_1.addToWaitlist)({ email, plan, owner, addedAt: new Date().toISOString() });
        return res.status(200).json({ ok: true });
    }
    catch (err) {
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
app.get("/admin/waitlist", async (req, res) => {
    const adminKey = process.env.WAITLIST_ADMIN_KEY;
    if (!adminKey || req.query.key !== adminKey) {
        return res.status(404).send("Not found");
    }
    try {
        const entries = await (0, store_1.getWaitlist)();
        const lines = entries
            .sort((a, b) => a.addedAt.localeCompare(b.addedAt))
            .map((e) => `${e.email}\t${e.plan}\t${e.owner}\t${e.addedAt}`);
        res
            .type("text/plain")
            .send(`email\tplan\towner\taddedAt\n${lines.join("\n")}\n\n${entries.length} total signups.`);
    }
    catch (err) {
        console.error("Waitlist export error:", err);
        res.status(500).send("Could not load waitlist.");
    }
});
// Debug fields (rawCheckoutEnabledValue / rawCheckoutEnabledLength) show exactly what
// the server sees for GUMROAD_CHECKOUT_ENABLED — no guessing whether a typo, stray
// whitespace, or wrong casing is why /subscribe is still showing the waitlist view.
// A value like "true " (trailing space) looks identical to "true" in most UI text
// boxes but has length 5, not 4, and fails the strict === "true" check silently.
app.post("/api/scan", async (req, res) => {
    const expectedToken = process.env.WARDEN_API_TOKEN;
    const suppliedToken = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (!expectedToken || suppliedToken !== expectedToken)
        return res.status(401).json({ ok: false, error: "Unauthorized" });
    const files = Array.isArray(req.body?.files) ? req.body.files : [];
    if (files.length === 0 || files.length > 250)
        return res.status(400).json({ ok: false, error: "files must contain 1-250 changed files" });
    try {
        const result = await (0, scan_1.scanFiles)(files);
        const policy = (0, enterprise_1.evaluatePolicy)(result, enterprise_1.defaultScanPolicy);
        const format = String(req.query.format || "json");
        const payload = format === "sarif" ? (0, enterprise_1.toSarif)(result) : format === "cyclonedx" ? (0, enterprise_1.toCycloneDx)(result) : { ok: true, ...result, policy };
        res.type(format === "sarif" ? "application/sarif+json" : "application/json");
        return res.json(JSON.parse((0, enterprise_1.redact)(JSON.stringify(payload))));
    }
    catch (error) {
        console.error("Scan API error:", error);
        return res.status(500).json({ ok: false, error: "Scan failed" });
    }
});
app.get("/health", (_req, res) => {
    const rawFlag = process.env.GUMROAD_CHECKOUT_ENABLED;
    res.json({
        ok: true,
        gumroadWebhookConfigured: Boolean(process.env.GUMROAD_WEBHOOK_SECRET),
        checkoutEnabled: rawFlag !== "false",
        rawCheckoutEnabledValue: rawFlag ?? null,
        plans: {
            pro: Boolean(process.env.GUMROAD_CHECKOUT_PRO && process.env.GUMROAD_PRODUCT_PRO),
            team: Boolean(process.env.GUMROAD_CHECKOUT_TEAM && process.env.GUMROAD_PRODUCT_TEAM),
            enterprise: Boolean(process.env.GUMROAD_CHECKOUT_ENTERPRISE && process.env.GUMROAD_PRODUCT_ENTERPRISE),
        },
    });
});
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    const hasRedis = Boolean(process.env.UPSTASH_REDIS_REST_URL?.trim() && process.env.UPSTASH_REDIS_REST_TOKEN?.trim());
    (0, popularPackageRefresh_1.schedulePopularPackageRefresh)({ redis: hasRedis ? (0, redis_1.getRedisClient)() : undefined });
});
