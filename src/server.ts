import express, { Request, Response } from "express";
import path from "path";
import { readFileSync } from "fs";
import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { setProStatus, getOwnerForSale, addToWaitlist, getWaitlist } from "./billing/store";
import { scanFiles, ScannedFile, type ScanAnnotation } from "./scan";
import { defaultScanPolicy, evaluatePolicy, toCycloneDx, toSarif, redact } from "./scan/enterprise";
import { assessPackage } from "./scan/riskSignals";
import { queryMalwareAdvisories, osvEcosystemFor } from "./scan/advisories";
import { npmEcosystem } from "./scan/ecosystems/npm";
  import { pypiEcosystem } from "./scan/ecosystems/pypi";
  import { cargoEcosystem } from "./scan/ecosystems/cargo";
  import { goEcosystem } from "./scan/ecosystems/go";
import type { Ecosystem } from "./scan/ecosystems/types";
import { db } from "./db";
import { repositories, scanRuns, findings, auditEvents, installations, remediations, policies, policyVersions, suppressions } from "./db/schema";
import { DEFAULT_POLICY, validatePolicy, evaluateGate, policyAuditEvent, policyToCycloneDx, type EnforcementPolicy, type PolicySuppression, type PolicyDecision } from "./enforcement/policy";
import { createWebhookHandler } from "./github/webhookHandler";
import { createDurableWebhookStore } from "./github/webhookStore";
import { getRedisClient } from "./lib/redis";
import { getGumroadApiToken, verifyGumroadSale } from "./billing/gumroadConnect";
import { getProRecord, isProActive } from "./billing/store";
import { schedulePopularPackageRefresh } from "./scan/popularPackageRefresh";
import { setInstallationCorpusOptOut, setPrivateCorpusOptIn } from "./telemetry/corpusLog";
import { authorizeInstallationRepositoryWrite, authorizeRunAccess, isUuid, sessionTokenFromRequest } from "./auth/runAccess";
import { getInstallationClient } from "./github/appAuth";
import { applyDependencyRemediation, manifestDiffIsScoped } from "./remediation/engine";
import { createRemediationPullRequest } from "./remediation/github";
import { resolveOsvAdvisory } from "./remediation/osv";
import { sendApprovedEmail, sendGmailCampaignEmail, getGmailToken, startGmailAuthorization } from "./automation/connect";
import { sendGmailMessage } from "./outreach/gmail";
import { buildSafeDraft, parseOptInAudience } from "./outreach/audience";

import { CANONICAL_BASE_URL } from "./lib/publicUrl";

  const app = express();
  app.disable("x-powered-by");
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    if (process.env.NODE_ENV === "production") res.setHeader("Strict-Transport-Security", "max-age=63072000");
    next();
  });
  const PORT = Number(process.env.PORT || 3000);
const OAUTH_STATE_COOKIE = "warden_oauth_state";
// Marks a GitHub OAuth flow that was started by an editor/CLI client rather than a
// browser session. When present on the callback, the established session id is parked
// in Redis under the client-supplied state so the extension can claim it once.
const OAUTH_CLI_COOKIE = "warden_cli_state";
const CLI_STATE_PATTERN = /^[a-f0-9]{16,64}$/i;
const CLI_SESSION_TTL_SECONDS = 300;
const SESSION_COOKIE = "warden_session";
const SESSION_TTL_SECONDS = 60 * 60 * 8;
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_BODY_BYTES = 1_000_000;
const MAX_REQUESTS_PER_WINDOW = 120;
const requestBuckets = new Map<string, { startedAt: number; count: number }>();

function requestId(req: Request): string {
  const candidate = req.headers["x-request-id"];
  return typeof candidate === "string" && /^[A-Za-z0-9._-]{1,100}$/.test(candidate) ? candidate : randomBytes(12).toString("hex");
}

function canonicalOrigin(req: Request): string {
  if (CANONICAL_BASE_URL) return CANONICAL_BASE_URL;
  return `${req.protocol}://${req.get("host")}`.replace(/\/$/, "");
}

function withTimeout<T>(promise: Promise<T>, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
  return Promise.race([promise, new Promise<T>((_, reject) => setTimeout(() => reject(new Error("Upstream request timed out")), timeoutMs))]);
}

function cookieValue(req: Request, name: string): string | undefined {
  const header = req.headers.cookie ?? "";
  return header.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1);
}

function secureCookie(req: Request): string {
  return req.secure || req.headers["x-forwarded-proto"] === "https" ? "; Secure" : "";
}

function signOAuthState(nonce: string): string {
  const secret = process.env.GITHUB_OAUTH_CLIENT_SECRET;
  if (!secret) throw new Error("GITHUB_OAUTH_CLIENT_SECRET is not configured");
  const signature = createHmac("sha256", secret).update(nonce).digest("hex");
  return `${nonce}.${signature}`;
}

function validOAuthState(state: string, expected: string): boolean {
  if (!state || state !== expected) return false;
  const [nonce, signature] = state.split(".");
  if (!nonce || !signature || signature.length !== 64) return false;
  const expectedSignature = createHmac("sha256", process.env.GITHUB_OAUTH_CLIENT_SECRET || "").update(nonce).digest("hex");
  return timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
}

async function githubJson<T>(url: string, token: string): Promise<T> {
  const response = await withTimeout(fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" } }));
  if (!response.ok) throw new Error(`GitHub OAuth request failed (${response.status})`);
  return await response.json() as T;
}

type OAuthSession = { accessToken: string; login: string; expiresAt: number };

async function getOAuthSession(req: Request): Promise<OAuthSession | null> {
  const sessionId = cookieValue(req, SESSION_COOKIE);
  if (!sessionId) return null;
  const session = await getRedisClient().get<OAuthSession>(`warden:oauth:session:${sessionId}`);
  if (!session || typeof session !== "object" || !session.accessToken || !session.login || session.expiresAt <= Date.now()) return null;
  return session;
}

async function dashboardInstallation(req: Request, installationId: number): Promise<boolean | null> {
  const session = await getOAuthSession(req);
  if (!session) return null;
  if (!db) return false;
  const installation = (await db.select({ accountLogin: installations.accountLogin }).from(installations).where(eq(installations.githubInstallationId, installationId)).limit(1))[0];
  return Boolean(installation && installation.accountLogin.toLowerCase() === session.login.toLowerCase());
}

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

function trustedGumroadCheckout(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !/(^|\.)gumroad\.com$/i.test(url.hostname)) return "";
    return url.toString();
  } catch {
    return "";
  }
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
    checkoutUrl: () => trustedGumroadCheckout(process.env.GUMROAD_CHECKOUT_PRO || ""),
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
} as const;

type PlanKey = keyof typeof plans;

// Gumroad sends form-encoded ping notifications. Keep this route before express.json().
app.post(
  "/billing/webhook",
  express.urlencoded({ extended: false }),
  async (req: Request, res: Response) => {
    const secret = process.env.GUMROAD_WEBHOOK_SECRET || "";
    if (!secret) return res.status(500).send("Webhook is not configured");

    const provided = String(req.body?.license_key || req.body?.custom_fields || "");
    const expected = createHmac("sha256", secret).update(provided).digest("hex");
    const signature = String(req.headers["x-gumroad-signature"] || req.body?.signature || "");
    if (!signature || signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
      return res.status(401).send("Invalid signature");
    }

    const saleId = String(req.body?.sale_id || req.body?.id || "").trim();
    const subscriptionId = String(req.body?.subscription_id || "").trim();
    const productId = String(req.body?.product_id || "").trim();
    const productMap = Object.fromEntries((Object.keys(plans) as PlanKey[]).map((key) => [plans[key].productId(), key]));
    const plan = productMap[productId] as PlanKey | undefined;
    if (plan && plan !== "pro") return res.status(400).send("This tier is not available yet");
    if (!saleId || !plan) return res.status(400).send("Unknown product or malformed sale");

    // Primary path: a Custom Field named "githubOwner" configured on the product,
    // auto-filled via ?githubOwner=<value> on the checkout link, arrives here as
    // custom_fields.githubOwner (per Gumroad's Custom Fields mechanism).
    //
    // Fallback: a plain (non-custom-field) URL parameter of the same name arrives
    // nested under url_params, flattened by form-encoding to "url_params[githubOwner]" —
    // NOT as a top-level field. Checked here in case the custom field is ever
    // removed or misconfigured, so a sale doesn't silently fail to grant access.
    const fields = typeof req.body?.custom_fields === "string" ? JSON.parse(req.body.custom_fields) : req.body?.custom_fields || {};
    const owner = String(
      req.body?.["url_params[githubOwner]"] ||
      fields.githubOwner ||
      ""
    ).trim().toLowerCase();
    const existingOwner = await getOwnerForSale(saleId);
    const resolvedOwner = owner || existingOwner;
    if (!resolvedOwner) return res.status(200).send("Ignored: owner unavailable");

    const refunded = String(req.body?.refunded || "false") === "true";
    const canceled = String(req.body?.subscription_cancelled_at || "").trim().length > 0;
    await setProStatus({
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
  },
);

// GitHub webhook MUST receive the raw request body for HMAC signature verification —
// same reasoning as the Gumroad webhook above, registered before express.json() for
// the same reason: JSON.stringify(JSON.parse(body)) is not guaranteed to byte-match
// what GitHub actually signed.
app.post(
  "/api/github/webhooks",
  express.raw({ type: "application/json" }),
  async (req: Request, res: Response) => {
    try {
      await withTimeout(createWebhookHandler({
      store: createDurableWebhookStore(),
      process: async (_payload, deliveryId) => {
        console.info(JSON.stringify({ event: "webhook_processing_deferred", deliveryId }));
      },
    })(req, res));
    } catch (error) {
      console.error(JSON.stringify({ event: "webhook_failed", error: error instanceof Error ? error.message : "unknown" }));
      if (!res.headersSent) res.status(504).json({ ok: false, error: "Webhook processing timed out or failed" });
    }
  },
  );

  app.use((req: Request, res: Response, next) => {
    const ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown").split(",")[0].trim();
    const now = Date.now();
    const bucket = requestBuckets.get(ip);
    const current = !bucket || now - bucket.startedAt >= 60_000 ? { startedAt: now, count: 0 } : bucket;
    current.count += 1;
    requestBuckets.set(ip, current);
    if (current.count > MAX_REQUESTS_PER_WINDOW) return res.status(429).json({ ok: false, error: "Too many requests" });
    const id = requestId(req);
    res.setHeader("X-Request-Id", id);
    res.locals.requestId = id;
    const started = Date.now();
    res.on("finish", () => console.info(JSON.stringify({ event: "http_request", requestId: id, method: req.method, path: req.path, status: res.statusCode, durationMs: Date.now() - started })));
    next();
  });

  app.get("/health", (_req: Request, res: Response) => {
    const rawFlag = process.env.GUMROAD_CHECKOUT_ENABLED;
    return res.json({
      ok: true,
      service: "warden",
      status: "live",
      checkoutEnabled: rawFlag !== "false",
      plans: {
        pro: Boolean(process.env.GUMROAD_CHECKOUT_PRO && process.env.GUMROAD_PRODUCT_PRO),
        team: Boolean(process.env.GUMROAD_CHECKOUT_TEAM && process.env.GUMROAD_PRODUCT_TEAM),
        enterprise: Boolean(process.env.GUMROAD_CHECKOUT_ENTERPRISE && process.env.GUMROAD_PRODUCT_ENTERPRISE),
      },
    });
  });
  app.get("/ready", (_req: Request, res: Response) => {
    const redisReady = Boolean(process.env.UPSTASH_REDIS_REST_URL?.trim() && process.env.UPSTASH_REDIS_REST_TOKEN?.trim());
    const githubReady = Boolean(process.env.GITHUB_APP_ID?.trim() && process.env.GITHUB_PRIVATE_KEY?.trim() && process.env.GITHUB_WEBHOOK_SECRET?.trim());
    const ready = redisReady && githubReady;
    return res.status(ready ? 200 : 503).json({ ok: ready, status: ready ? "ready" : "degraded", dependencies: { redis: redisReady, github: githubReady } });
  });

  app.use(express.json({ limit: `${MAX_BODY_BYTES}b` }));


function requireWardenToken(req: Request, res: Response): boolean {
  const token = String(req.headers.authorization || "").replace(/^Bearer\\s+/i, "");
  if (!process.env.WARDEN_API_TOKEN || token !== process.env.WARDEN_API_TOKEN) {
    res.status(401).json({ ok: false, error: "Unauthorized" });
    return false;
  }
  return true;
}

async function gmailSubjectId(req: Request): Promise<string | null> {
  const sessionToken = await sessionTokenFromRequest(req);
  if (!sessionToken) return null;
  const response = await fetch("https://api.github.com/user", { headers: { Authorization: `Bearer ${sessionToken}`, Accept: "application/vnd.github+json" } });
  if (!response.ok) return null;
  const user = await response.json() as { id?: number };
  return user.id ? `github:${user.id}` : null;
}

app.get("/api/automation/gmail/status", async (req: Request, res: Response) => {
  const subjectId = await gmailSubjectId(req);
  if (!subjectId) return res.status(401).json({ ok: false, connected: false, error: "Sign in to Warden first" });
  try { await getGmailToken(subjectId); return res.json({ ok: true, connected: true }); }
  catch { return res.json({ ok: true, connected: false }); }
});

app.get("/api/automation/gmail/connect", async (req: Request, res: Response) => {
  const subjectId = await gmailSubjectId(req);
  if (!subjectId) return res.status(401).json({ ok: false, error: "Sign in to Warden first" });
  try {
    const url = await startGmailAuthorization(subjectId, `${canonicalOrigin(req)}/api/automation/gmail/callback`);
    return res.json({ ok: true, url });
  } catch (error) {
    console.error("Gmail authorization start failed:", error);
    return res.status(502).json({ ok: false, error: "Could not start Gmail authorization" });
  }
});

app.get("/api/automation/gmail/callback", (_req: Request, res: Response) => {
  res.type("html").send("<!doctype html><html><body style=\"font-family:system-ui;max-width:560px;margin:48px auto;padding:16px\"><h1>Gmail connected</h1><p>You can close this window and return to the Warden control room.</p></body></html>");
});

app.post("/api/automation/approvals/:approvalId/send", async (req: Request, res: Response) => {
  if (!requireWardenToken(req, res)) return;
  const approvalId = String(req.params.approvalId || "").trim();
  const to = Array.isArray(req.body?.to) ? req.body.to.filter((value: unknown): value is string => typeof value === "string" && value.includes("@")) : [];
  const subject = String(req.body?.subject || "").trim();
  const text = String(req.body?.text || "").trim();
  if (!approvalId || !to.length || !subject || !text) return res.status(400).json({ ok: false, error: "approvalId, recipient, subject, and text are required" });
  try {
    const delivery = await sendApprovedEmail({ approvalId, to, subject, text });
    return res.status(202).json({ ok: true, status: "queued", deliveryId: delivery.id || null });
  } catch (error) {
    console.error("Approved email delivery failed:", error);
    return res.status(502).json({ ok: false, error: "Could not deliver approved email" });
  }
});

const campaignEmailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
app.post("/api/automation/campaigns/preview", (req: Request, res: Response) => {
  if (!requireWardenToken(req, res)) return;
  const raw = Array.isArray(req.body?.recipients) ? req.body.recipients : [];
  const normalized: string[] = raw.map((value: unknown) => String(value).trim().toLowerCase()).filter((value: string): value is string => Boolean(value));
  const unique: string[] = [...new Set(normalized)];
  const valid = unique.filter((email) => campaignEmailPattern.test(email)).slice(0, 500);
  return res.json({ ok: true, valid, invalid: unique.filter((email) => !campaignEmailPattern.test(email)), duplicates: normalized.length - unique.length, capped: unique.length > 500 });
});

app.post("/api/automation/campaigns/:campaignId/send", async (req: Request, res: Response) => {
  if (!requireWardenToken(req, res)) return;
  const campaignId = String(req.params.campaignId || "").trim();
  const recipients = Array.isArray(req.body?.recipients) ? [...new Set((req.body.recipients as unknown[]).map((value) => String(value).trim().toLowerCase()).filter((email) => campaignEmailPattern.test(email)))] : [];
  const subject = String(req.body?.subject || "").trim();
  const html = String(req.body?.html || "").trim();
  const authorized = req.body?.authorizationConfirmed === true;
  const subjectId = await gmailSubjectId(req);
  const unsubscribeUrl = `${CANONICAL_BASE_URL}/api/automation/unsubscribe?campaign=${encodeURIComponent(campaignId)}`;
  const campaignHtml = html.replaceAll("{{UNSUBSCRIBE_URL}}", unsubscribeUrl);
  if (!campaignId || !recipients.length || recipients.length > 100 || !subject || !html || !authorized) return res.status(400).json({ ok: false, error: "Campaign requires a verified audience, content, authorization confirmation, and no more than 100 recipients" });
  if (!subjectId) return res.status(503).json({ ok: false, error: "Gmail sender is not configured. Set WARDEN_GMAIL_SUBJECT_ID to the authorized Warden operator identity." });
  if (!campaignHtml.toLowerCase().includes("unsubscribe")) return res.status(400).json({ ok: false, error: "Every promotional message must include an unsubscribe link." });
  try {
    const deliveries = [];
    for (const recipient of recipients) {
      const delivery = await sendGmailCampaignEmail({ subjectId, to: recipient, subject, html: campaignHtml, campaignId, unsubscribeUrl });
      deliveries.push({ recipient, providerId: delivery.id || null });
    }
    return res.status(202).json({ ok: true, status: "sent", campaignId, provider: "gmail", deliveries });
  } catch (error) {
    console.error("Gmail campaign delivery failed:", error);
    return res.status(502).json({ ok: false, error: error instanceof Error ? error.message : "Could not deliver campaign through Gmail" });
  }
});

app.get("/api/automation/unsubscribe", (req: Request, res: Response) => {
  res.type("html").send("<!doctype html><html><body style=\"font-family:system-ui;max-width:560px;margin:48px auto;padding:16px\"><h1>Warden CI email preferences</h1><p>Your unsubscribe request was received. No further campaign messages will be sent from this deployment.</p></body></html>");
});

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

// Serve the landing page at the domain root. Gumroad's domain-approval review checks
// the root URL you submit (e.g. https://warden-ci-dvk5.onrender.com/) for links to
// terms/privacy/refund policy — without this route, that URL 404'd with "Cannot GET /"
// and Gumroad's reviewer would have no way to find those links at all.
app.get("/", (_req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, "..", "index.html"));
});

app.get("/api/runs/:runId", async (req: Request, res: Response) => {
  const runId = String(req.params.runId || "");
  if (!isUuid(runId)) return res.status(404).json({ ok: false, error: "Run not found" });
  try {
    const access = await authorizeRunAccess(req, runId);
    if (access.kind === "unauthenticated") return res.status(401).json({ ok: false, error: "GitHub login required" });
    if (access.kind === "not_found") return res.status(404).json({ ok: false, error: "Run not found" });
    if (access.kind === "forbidden") return res.status(403).json({ ok: false, error: "Run access is not authorized" });
    if (!db) return res.status(503).json({ ok: false, error: "Database unavailable" });
    const repository = (await db.select({ fullName: repositories.fullName, defaultBranch: repositories.defaultBranch })
      .from(repositories).innerJoin(scanRuns, eq(scanRuns.repositoryId, repositories.id)).where(eq(scanRuns.id, runId)).limit(1))[0];
    const reportFindings = await db.select({
      id: findings.id, fingerprint: findings.fingerprint, severity: findings.severity, category: findings.category, title: findings.title,
      message: findings.message, filePath: findings.filePath, lineNumber: findings.lineNumber,
      remediation: findings.remediation, packageName: findings.packageName, ecosystem: findings.ecosystem, manifestPath: findings.manifestPath, advisoryId: findings.advisoryId, affectedRange: findings.affectedRange, currentVersion: findings.currentVersion, status: findings.status, createdAt: findings.createdAt,
    }).from(findings).where(eq(findings.scanRunId, runId));

    // Standard-format exports for the authorized run. SARIF reuses the enterprise
    // exporter (all findings); CycloneDX reuses the enforcement exporter (dependency
    // findings). redact() strips any secret-like tokens before download.
    const format = String(req.query.format || "");
    if (format === "sarif" || format === "cyclonedx") {
      const annotations: ScanAnnotation[] = reportFindings.map((f) => ({
        path: f.filePath || "", line: f.lineNumber || 0, message: f.message, title: f.title,
        severity: f.severity === "warning" ? "warning" : "failure", category: f.category as ScanAnnotation["category"],
        confidence: "high", remediation: f.remediation || "", fingerprint: f.fingerprint,
        packageName: f.packageName || undefined, ecosystem: f.ecosystem || undefined, manifestPath: f.manifestPath || undefined,
      }));
      const document = format === "sarif"
        ? toSarif({ annotations } as unknown as Parameters<typeof toSarif>[0])
        : policyToCycloneDx(annotations);
      const filename = `warden-run-${runId}.${format === "sarif" ? "sarif" : "cyclonedx"}.json`;
      res.type(format === "sarif" ? "application/sarif+json" : "application/vnd.cyclonedx+json");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      return res.send(redact(JSON.stringify(document, null, 2)));
    }
    return res.json({ ok: true, run: {
      id: access.run.id, scanTimestamp: access.run.completedAt || access.run.startedAt || access.run.createdAt,
      createdAt: access.run.createdAt, pullRequestNumber: access.run.pullRequestNumber,
      commitSha: access.run.commitSha, status: access.run.status, verdict: access.run.verdict,
      findingsCount: access.run.findingsCount, repository: repository?.fullName || null,
      defaultBranch: repository?.defaultBranch || null,
      findings: reportFindings,
    }});
  } catch (error) {
    console.error("Run report access failed:", error);
    return res.status(502).json({ ok: false, error: "Could not load run report" });
  }
});

app.post("/api/runs/:runId/findings/:findingId/fix", async (req: Request, res: Response) => {
  const runId = String(req.params.runId || "");
  const findingId = String(req.params.findingId || "");
  if (!isUuid(runId) || !isUuid(findingId)) return res.status(404).json({ ok: false, error: "Finding not found" });
  try {
    const access = await authorizeRunAccess(req, runId);
    if (access.kind === "unauthenticated") return res.status(401).json({ ok: false, error: "GitHub login required" });
    if (access.kind === "not_found") return res.status(404).json({ ok: false, error: "Run not found" });
    if (access.kind === "forbidden") return res.status(403).json({ ok: false, error: "Remediation is not authorized" });
    if (!db) return res.status(503).json({ ok: false, error: "Database unavailable" });
    const row = (await db.select({ finding: findings, repository: repositories, installation: installations }).from(findings).innerJoin(scanRuns, eq(findings.scanRunId, scanRuns.id)).innerJoin(repositories, eq(scanRuns.repositoryId, repositories.id)).innerJoin(installations, eq(repositories.installationId, installations.id)).where(and(eq(findings.id, findingId), eq(findings.scanRunId, runId))).limit(1))[0];
    if (!row) return res.status(404).json({ ok: false, error: "Finding not found" });
    const finding = row.finding;
    if (!finding.packageName || !finding.ecosystem || !finding.currentVersion || !finding.manifestPath) {
      return res.status(202).json({ ok: true, status: "fix_proposed", verificationStatus: "human_review_required", error: "This finding requires a reviewed remediation proposal" });
    }
    const ecosystem = finding.ecosystem === "pypi" ? "python" : finding.ecosystem === "npm" ? "npm" : null;
    if (!ecosystem) return res.status(202).json({ ok: true, status: "fix_proposed", verificationStatus: "human_review_required", error: "This finding requires a reviewed remediation proposal" });
    const userToken = await sessionTokenFromRequest(req);
    if (!userToken) return res.status(401).json({ ok: false, error: "GitHub login required" });
    const writeAccess = await authorizeInstallationRepositoryWrite(userToken, row.installation.githubInstallationId, row.repository.githubRepositoryId, fetch);
    if (writeAccess !== "authorized") return res.status(403).json({ ok: false, status: "permission_required", error: "GitHub repository write permission is required" });
    // Verified auto-fix (OSV lookup + remediation PR) is a Pro/Team/Enterprise
    // capability — free tier gets the finding and the recommended remediation
    // text, but not an automatically opened pull request.
    let remediationProActive = false;
    try {
      remediationProActive = await isProActive(row.installation.accountLogin);
    } catch (err) {
      console.error(`Could not check Pro status for ${row.installation.accountLogin}, failing closed:`, err);
      remediationProActive = false;
    }
    if (!remediationProActive) {
      return res.status(402).json({
        ok: false,
        status: "upgrade_required",
        error: "Automatic remediation pull requests require an active Pro plan.",
        upgradeUrl: `${CANONICAL_BASE_URL}/subscribe?owner=${encodeURIComponent(row.installation.accountLogin)}&plan=pro`,
      });
    }
    const advisory = await resolveOsvAdvisory(ecosystem, finding.packageName, finding.currentVersion);
    if (!advisory?.fixedVersion) return res.status(409).json({ ok: false, status: "remediation_unavailable", error: "OSV did not provide enough data for a safe target" });
    const existing = (await db.select().from(remediations).where(and(eq(remediations.findingId, findingId), eq(remediations.targetVersion, advisory.fixedVersion))).limit(1))[0];
    if (existing?.pullRequestUrl && existing.pullRequestNumber) return res.json({ ok: true, status: "already_has_remediation_pr", pullRequestUrl: existing.pullRequestUrl, pullRequestNumber: existing.pullRequestNumber });
    const octokit = getInstallationClient(row.installation.githubInstallationId);
    const [owner, repo] = row.repository.fullName.split("/");
    if (!owner || !repo) return res.status(409).json({ ok: false, status: "remediation_unavailable", error: "Repository identity is invalid" });
    const base = await octokit.repos.getBranch({ owner, repo, branch: row.repository.defaultBranch });
    const file = await octokit.repos.getContent({ owner, repo, path: finding.manifestPath, ref: base.data.commit.sha });
    if (Array.isArray(file.data) || !("content" in file.data)) return res.status(409).json({ ok: false, status: "remediation_unavailable", error: "Supported manifest was not found" });
    const before = Buffer.from(file.data.content, "base64").toString("utf8");
    const result = applyDependencyRemediation({ ecosystem, packageName: finding.packageName, vulnerableRange: advisory.affectedRange, targetVersion: advisory.fixedVersion, manifestPath: finding.manifestPath, manifestContent: before });
    if (!manifestDiffIsScoped(before, result.manifestContent, finding.packageName)) return res.status(409).json({ ok: false, status: "verification_failed", error: "Remediation changed more than the intended dependency" });
    const remediation = await db.insert(remediations).values({ findingId, installationId: row.repository.installationId, repositoryId: row.repository.id, packageName: finding.packageName, targetVersion: advisory.fixedVersion, status: "validation_passed", verificationStatus: "pending_rescan" }).onConflictDoNothing().returning({ id: remediations.id });
    const created = remediation[0];
    if (!created) return res.status(200).json({ ok: true, status: "fix_proposed", verificationStatus: "pending_rescan", error: "An identical remediation is already in progress" });
    const pr = await createRemediationPullRequest(octokit, { owner, repo, baseBranch: row.repository.defaultBranch, baseSha: base.data.commit.sha, runId, findingId, reportUrl: `${CANONICAL_BASE_URL}/details?runId=${runId}`, advisoryId: advisory.id, result });
    await db.update(remediations).set({ status: "pr_created", branchName: pr.branch, pullRequestNumber: pr.pullRequestNumber, pullRequestUrl: pr.pullRequestUrl, verificationStatus: "pending_rescan", updatedAt: new Date() }).where(eq(remediations.id, created.id));
    return res.status(201).json({ ok: true, status: "pr_created", verificationStatus: "pending_rescan", pullRequestUrl: pr.pullRequestUrl, pullRequestNumber: pr.pullRequestNumber });
  } catch (error) {
    console.error("Remediation request failed:", error);
    return res.status(502).json({ ok: false, error: "Could not evaluate remediation request" });
  }
});

app.get("/api/remediations/:remediationId", async (req: Request, res: Response) => {
  const session = await getOAuthSession(req);
  if (!session || !db || !isUuid(String(req.params.remediationId || ""))) return res.status(404).json({ ok: false, error: "Remediation not found" });
  const remediation = (await db.select({ remediation: remediations, installationLogin: installations.accountLogin }).from(remediations).innerJoin(installations, eq(remediations.installationId, installations.id)).where(eq(remediations.id, String(req.params.remediationId))).limit(1))[0];
  if (!remediation || remediation.installationLogin.toLowerCase() !== session.login.toLowerCase()) return res.status(404).json({ ok: false, error: "Remediation not found" });
  return res.json({ ok: true, remediation: remediation.remediation, canBeVerified: remediation.remediation.status === "pr_created" && remediation.remediation.verificationStatus === "pending_rescan" });
});

app.get("/details", (req: Request, res: Response) => {
  if (!req.query.runId) return res.sendFile(path.join(__dirname, "..", "index.html"));
  res.sendFile(path.join(__dirname, "..", "report.html"));
});

app.get("/dashboard", (_req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, "..", "dashboard.html"));
});

app.get("/policy", (_req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, "..", "policy.html"));
});

app.get("/upgrade", (_req: Request, res: Response) => {
  res.redirect(302, "/subscribe?plan=pro");
});

app.get("/auth/github", async (req: Request, res: Response) => {
  const clientId = process.env.GITHUB_OAUTH_CLIENT_ID;
  if (!clientId) return res.status(503).send("GitHub OAuth is not configured");
  const state = signOAuthState(randomBytes(24).toString("hex"));
  const callback = `${canonicalOrigin(req)}/auth/github/callback`;
  const cookies = [`${OAUTH_STATE_COOKIE}=${state}; HttpOnly; SameSite=Lax; Path=/${secureCookie(req)}`];
  // Editor sign-in: the extension opens this URL with ?cli=<state> so the callback
  // can hand the resulting session back to it out-of-band (see /api/cli/session).
  const cliState = String(req.query.cli || "");
  if (CLI_STATE_PATTERN.test(cliState)) cookies.push(`${OAUTH_CLI_COOKIE}=${cliState}; HttpOnly; SameSite=Lax; Path=/${secureCookie(req)}`);
  res.setHeader("Set-Cookie", cookies);
  return res.redirect(`https://github.com/login/oauth/authorize?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(callback)}&state=${encodeURIComponent(state)}&scope=`);
});

app.get("/auth/github/callback", async (req: Request, res: Response) => {
  const state = String(req.query.state || "");
  const expected = cookieValue(req, OAUTH_STATE_COOKIE);
  if (!expected || !validOAuthState(state, expected)) return res.status(403).send("Invalid OAuth state");
  res.setHeader("Set-Cookie", `${OAUTH_STATE_COOKIE}=; Max-Age=0; HttpOnly; SameSite=Lax; Path=/${secureCookie(req)}`);
  if (!req.query.code) return res.status(400).send("Missing OAuth code");
  try {
    const response = await fetch("https://github.com/login/oauth/access_token", { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify({ client_id: process.env.GITHUB_OAUTH_CLIENT_ID, client_secret: process.env.GITHUB_OAUTH_CLIENT_SECRET, code: String(req.query.code || "") }) });
    const data = await response.json() as { access_token?: string };
    if (!data.access_token) return res.status(401).send("GitHub OAuth failed");
    const identity = await githubJson<{ login?: string }>("https://api.github.com/user", data.access_token);
    if (!identity.login) return res.status(401).send("GitHub identity unavailable");
    const sessionId = randomBytes(32).toString("hex");
    const session: OAuthSession = { accessToken: data.access_token, login: identity.login, expiresAt: Date.now() + SESSION_TTL_SECONDS * 1000 };
    await getRedisClient().set(`warden:oauth:session:${sessionId}`, session, { ex: SESSION_TTL_SECONDS });
    const cookies = [`${SESSION_COOKIE}=${sessionId}; HttpOnly; SameSite=Lax; Path=/${secureCookie(req)}`];
    // Editor sign-in handoff: park the session id under the client-supplied state
    // (short TTL, single claim) and show a "return to your editor" page instead of
    // redirecting to the dashboard the extension can't see.
    const cliState = cookieValue(req, OAUTH_CLI_COOKIE);
    if (cliState && CLI_STATE_PATTERN.test(cliState)) {
      await getRedisClient().set(`warden:cli:token:${cliState}`, sessionId, { ex: CLI_SESSION_TTL_SECONDS });
      cookies.push(`${OAUTH_CLI_COOKIE}=; Max-Age=0; HttpOnly; SameSite=Lax; Path=/${secureCookie(req)}`);
      res.setHeader("Set-Cookie", cookies);
      return res.type("html").send("<!doctype html><html><body style=\"font-family:system-ui;max-width:560px;margin:48px auto;padding:16px\"><h1>Signed in to Warden</h1><p>You can close this window and return to your editor — Warden Check will finish connecting automatically.</p></body></html>");
    }
    res.setHeader("Set-Cookie", cookies);
    return res.redirect("/dashboard");
  } catch (error) {
    console.error("GitHub OAuth callback failed:", error);
    return res.status(502).send("GitHub OAuth is unavailable");
  }
});

app.get("/api/billing/status", async (req: Request, res: Response) => {
  const installationId = Number(req.query.installationId);
  if (!Number.isSafeInteger(installationId) || installationId <= 0) return res.status(400).json({ ok: false, error: "Invalid installation ID" });
  try {
    const authorized = await dashboardInstallation(req, installationId);
    if (authorized === null) return res.status(401).json({ ok: false, error: "GitHub login required" });
    if (!authorized) return res.status(403).json({ ok: false, error: "Installation is not authorized for this GitHub account" });
    if (!db) return res.status(503).json({ ok: false, error: "Database unavailable" });
    const installation = (await db.select({ accountLogin: installations.accountLogin, plan: installations.plan }).from(installations).where(eq(installations.githubInstallationId, installationId)).limit(1))[0];
    if (!installation) return res.status(404).json({ ok: false, error: "Installation not found" });
    const record = await getProRecord(installation.accountLogin);
    return res.json({ ok: true, plan: record?.status === "active" || record?.status === "trialing" ? record.plan : installation.plan, status: record?.status || "free", updatedAt: record?.updatedAt || null });
  } catch (error) {
    console.error("Billing status read failed:", error);
    return res.status(502).json({ ok: false, error: "Could not load billing status" });
  }
});

// ---------------------------------------------------------------------------
// Editor/CLI support endpoints (Phase 2)
//
// The VS Code extension is the consumer. Package detection stays server-side so a
// single source of truth (src/scan/riskSignals.ts) drives both PR scans and in-editor
// checks — the extension never re-implements the heuristics and improves the moment
// this deploys, with no extension update required.
// ---------------------------------------------------------------------------

  const CLI_ECOSYSTEMS: Record<string, Ecosystem> = { npm: npmEcosystem, pypi: pypiEcosystem, cargo: cargoEcosystem, go: goEcosystem };

// Turns an assessPackage verdict into the same wording the PR scanner uses, so the
// extension can render a finding without duplicating message/remediation copy.
function describePackageVerdict(label: string, v: NonNullable<Awaited<ReturnType<typeof assessPackage>>>): { severity: "error" | "warning"; message: string; remediation: string } {
  switch (v.verdict) {
    case "hallucinated":
      return { severity: "error", message: `Package "${v.packageName}" was not found on the ${label} registry. If this was suggested by an AI tool, it may be a hallucinated package name — verify before installing, since attackers register exactly these invented names to distribute malware.`, remediation: `Confirm the package name on the ${label} registry and pin a trusted version before installing.` };
    case "typosquat-suspect":
      return { severity: "warning", message: `Package "${v.packageName}" exists but was only published ${v.publishedDaysAgo} day(s) ago and is a near-exact match for the popular package "${v.impersonating}". This is a common pattern for typosquat/slopsquat attacks — confirm this is the package you meant before installing.`, remediation: "Compare the package owner, repository, release history, and lockfile before adding this dependency." };
    case "dependency-confusion-suspect":
      return { severity: "warning", message: `Package "${v.packageName}" has a high major version (${v.latestVersion}) but a thin, recent release history — a review signal for possible version-shadowing behavior.`, remediation: "Compare this name against your private registries and lockfile policy, then verify the publisher and intended source before installing." };
    case "registry-unavailable":
      return { severity: "warning", message: `Warden could not verify "${v.packageName}" because the ${label} registry was unavailable. This is UNKNOWN, not safe or malicious.`, remediation: "Retry when the registry is available or verify the package directly before installing." };
    default:
      return { severity: "warning", message: `Package "${v.packageName}" appears to have a recent release from a different observed publisher (${v.latestPublisher ?? "unknown"}). Verify the release and publisher before installing.`, remediation: "Review the release provenance, publisher account, and lockfile before adding this dependency." };
  }
}

// Unauthenticated, best-effort single-package risk check. No source code ever leaves
// the editor — only a package name and ecosystem are sent. Covered by the global rate
// limiter above.
app.get("/api/check/package", async (req: Request, res: Response) => {
  const ecosystemId = String(req.query.ecosystem || "").toLowerCase();
  const name = String(req.query.name || "").trim();
  const ecosystem = CLI_ECOSYSTEMS[ecosystemId];
  if (!ecosystem) return res.status(400).json({ ok: false, error: "ecosystem must be one of: npm, pypi, cargo, go" });
  if (!name || name.length > 214 || !/^[@a-z0-9._/-]+$/i.test(name)) return res.status(400).json({ ok: false, error: "A valid package name is required" });
  try {
    // Threat-intel first: a confirmed malicious-package advisory is the strongest
    // possible signal and supersedes any softer metadata heuristic. This lets the
    // IDE extension flag realized slopsquat malware at suggestion-accept time.
    const osvEcosystem = osvEcosystemFor(ecosystem.id);
    const [verdict, malware] = await Promise.all([
      withTimeout(assessPackage(name, ecosystem), 8_000),
      osvEcosystem ? withTimeout(queryMalwareAdvisories([name], osvEcosystem), 8_000).catch(() => new Map()) : Promise.resolve(new Map()),
    ]);
    const advisory = malware.get(name);
    if (advisory) {
      return res.json({
        ok: true, ecosystem: ecosystem.id, name, flagged: true, verdict: "known-malware", severity: "error",
        osvId: advisory.osvId, reference: advisory.reference,
        message: `Package "${name}" has a confirmed malicious-package advisory on the ${ecosystem.label} registry.${advisory.summary ? ` ${advisory.summary}` : ""} An attacker registered this name and published malware under it — do not install it.`,
        remediation: `Remove "${name}", audit any machine that already installed it, and rotate exposed secrets. Advisory: ${advisory.reference ?? advisory.osvId}.`,
      });
    }
    if (!verdict) return res.json({ ok: true, ecosystem: ecosystem.id, name, flagged: false });
    const described = describePackageVerdict(ecosystem.label, verdict);
    return res.json({ ok: true, ecosystem: ecosystem.id, name, flagged: true, verdict: verdict.verdict, impersonating: verdict.impersonating, publishedDaysAgo: verdict.publishedDaysAgo, ...described });
  } catch (error) {
    console.error(JSON.stringify({ event: "package_check_failed", requestId: res.locals.requestId, error: error instanceof Error ? error.message : "unknown" }));
    // Fail open: an outage must never turn into a false "hallucinated" finding.
    return res.status(200).json({ ok: true, ecosystem: ecosystem.id, name, flagged: false, degraded: true });
  }
});

// Editor sign-in poll: returns the parked session id exactly once. The extension keeps
// polling until `token` appears, then stores it in VS Code SecretStorage.
app.get("/api/cli/session", async (req: Request, res: Response) => {
  const state = String(req.query.state || "");
  if (!CLI_STATE_PATTERN.test(state)) return res.status(400).json({ ok: false, error: "Invalid state" });
  try {
    const redis = getRedisClient();
    const token = await redis.get<string>(`warden:cli:token:${state}`);
    if (!token) return res.json({ ok: true, pending: true });
    await redis.del(`warden:cli:token:${state}`);
    return res.json({ ok: true, pending: false, token });
  } catch (error) {
    console.error("CLI session poll failed:", error);
    return res.status(502).json({ ok: false, error: "Could not check sign-in status" });
  }
});

// Free/Pro status for the extension status bar. Authenticated by the stored session id
// (sent as the warden_session cookie by the extension). Fails closed to free.
app.get("/api/cli/status", async (req: Request, res: Response) => {
  const session = await getOAuthSession(req);
  if (!session) return res.status(401).json({ ok: false, error: "Sign in to Warden first" });
  let pro = false;
  try { pro = await isProActive(session.login); }
  catch (error) { console.error(`CLI Pro check failed for ${session.login}, treating as free:`, error); pro = false; }
  return res.json({ ok: true, login: session.login, plan: pro ? "pro" : "free", pro });
});

app.get("/api/telemetry/settings", async (req: Request, res: Response) => {
  const installationId = Number(req.query.installationId);
  if (!Number.isSafeInteger(installationId) || installationId <= 0) return res.status(400).json({ ok: false, error: "Invalid installation ID" });
  try {
    const authorized = await dashboardInstallation(req, installationId);
    if (authorized === null) return res.status(401).json({ ok: false, error: "GitHub login required" });
    if (!authorized) return res.status(403).json({ ok: false, error: "Installation is not authorized for this GitHub account" });
    const redis = getRedisClient();
    return res.json({ ok: true, publicOptedOut: (await redis.get(`warden:telemetry:optout:${installationId}`)) === "1", privateOptedIn: (await redis.get(`warden:telemetry:optout:private:${installationId}`)) === "enabled" });
  } catch (error) { console.error("Telemetry settings read failed:", error); return res.status(502).json({ ok: false, error: "Could not verify GitHub installation" }); }
});

app.put("/api/telemetry/settings", async (req: Request, res: Response) => {
  const installationId = Number(req.body?.installationId);
  if (!Number.isSafeInteger(installationId) || installationId <= 0) return res.status(400).json({ ok: false, error: "Invalid installation ID" });
  try {
    const authorized = await dashboardInstallation(req, installationId);
    if (authorized === null) return res.status(401).json({ ok: false, error: "GitHub login required" });
    if (!authorized) return res.status(403).json({ ok: false, error: "Installation is not authorized for this GitHub account" });
    if (typeof req.body.publicOptedOut === "boolean") await setInstallationCorpusOptOut(installationId, req.body.publicOptedOut);
    if (typeof req.body.privateOptedIn === "boolean") await setPrivateCorpusOptIn(installationId, req.body.privateOptedIn);
    return res.json({ ok: true });
  } catch (error) { console.error("Telemetry settings write failed:", error); return res.status(502).json({ ok: false, error: "Could not update telemetry settings" }); }
});

app.post("/api/outreach/draft", async (req: Request, res: Response) => {
  if (!await getOAuthSession(req)) return res.status(401).json({ ok: false, error: "GitHub login required" });
  return res.json({ ok: true, draft: buildSafeDraft(req.body || {}) });
});

app.post("/api/outreach/validate", async (req: Request, res: Response) => {
  if (!await getOAuthSession(req)) return res.status(401).json({ ok: false, error: "GitHub login required" });
  try {
    const recipients = parseOptInAudience(String(req.body?.csv || ""));
    if (recipients.length === 0 || recipients.length > 50) return res.status(400).json({ ok: false, error: "Upload between 1 and 50 opted-in recipients" });
    return res.json({ ok: true, count: recipients.length, recipients: recipients.map(({ email, name, company }) => ({ email, name, company })) });
  } catch (error) { return res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "Invalid audience" }); }
});

app.post("/api/outreach/send", async (req: Request, res: Response) => {
  const session = await getOAuthSession(req);
  if (!session) return res.status(401).json({ ok: false, error: "GitHub login required" });
  const body = req.body as { from?: string; recipients?: Array<{ email: string; consent: boolean }>; subject?: string; html?: string; approved?: boolean };
  if (!body.approved) return res.status(409).json({ ok: false, error: "Human approval is required" });
  if (!body.from || !body.recipients?.length || body.recipients.length > 50 || !body.subject || !body.html) return res.status(400).json({ ok: false, error: "from, recipients, subject, and html are required" });
  if (body.recipients.some((recipient) => !recipient.consent || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(recipient.email))) return res.status(400).json({ ok: false, error: "Every recipient must be valid and opted in" });
  try {
    const sent: string[] = [];
    for (const recipient of body.recipients) {
      await sendGmailMessage({ id: `github:${session.login}`, issuer: "github" }, { from: body.from, to: recipient.email, subject: body.subject, html: body.html });
      sent.push(recipient.email);
    }
    return res.status(202).json({ ok: true, status: "accepted", sent });
  } catch (error) {
    console.error(JSON.stringify({ event: "outreach_send_failed", requestId: res.locals.requestId, error: error instanceof Error ? error.message : "unknown" }));
    return res.status(502).json({ ok: false, error: "Gmail authorization or delivery failed" });
  }
});

app.get("/api/dashboard/summary", async (req: Request, res: Response) => {
  const session = await getOAuthSession(req);
  if (!session) return res.status(401).json({ ok: false, error: "GitHub login required" });
  if (!db) return res.status(503).json({ ok: false, error: "Database unavailable" });
  const limit = Math.min(Math.max(Number(req.query.limit || 25), 1), 100);
  try {
    const ownedInstallations = await db.select({ id: installations.id }).from(installations).where(eq(installations.accountLogin, session.login));
    const installationIds = ownedInstallations.map((item) => item.id);
    if (installationIds.length === 0) return res.json({ ok: true, generatedAt: new Date().toISOString(), summary: { scans: 0, blocked: 0, findings: 0 }, runs: [], findings: [], audit: [] });
    const ownedRepositories = await db.select({ id: repositories.id }).from(repositories).where(inArray(repositories.installationId, installationIds));
    const repositoryIds = ownedRepositories.map((item) => item.id);
    const runs = repositoryIds.length ? await db.select().from(scanRuns).where(inArray(scanRuns.repositoryId, repositoryIds)).limit(limit) : [];
    const runIds = runs.map((run) => run.id);
    const recentFindings = runIds.length ? await db.select().from(findings).where(inArray(findings.scanRunId, runIds)).limit(limit) : [];
    const audit = await db.select().from(auditEvents).where(inArray(auditEvents.installationId, installationIds)).limit(limit);
    return res.json({ ok: true, generatedAt: new Date().toISOString(), summary: { scans: runs.length, blocked: runs.filter((run) => run.verdict === "failure").length, findings: recentFindings.length }, runs, findings: recentFindings, audit });
  } catch (error) {
    console.error("Dashboard summary error:", error);
    return res.status(500).json({ ok: false, error: "Could not load dashboard data" });
  }
});

// ---------------------------------------------------------------------------
// Policy CRUD API (Phase 1)
//
// src/enforcement/policy.ts owns how a policy is validated and evaluated. Policies
// are versioned: every save writes a new immutable row to warden_policy_versions,
// and the highest version number is the active one. warden_policies keeps a
// denormalized summary row (its boolean columns) in sync for other read paths, but
// the jsonb stored in warden_policy_versions is authoritative.
//
// Suppressions are managed through the dedicated warden_suppressions table (owner is
// stored in its created_by column), so the versioned policy JSON keeps its own
// suppressions array empty and the table entries are merged in at evaluation time.
//
// Per-repository policy storage does not exist in the current schema — policies are
// keyed by installation only — so an optional repositoryId is recorded in the audit
// trail for forward compatibility, but the effective policy is the installation
// policy merged over DEFAULT_POLICY.
// ---------------------------------------------------------------------------

function policyFieldForError(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes("mode")) return "mode";
  if (lower.includes("minimumseverity")) return "minimumSeverity";
  if (lower.includes("blockcategories")) return "blockCategories";
  if (lower.includes("ignoredpaths")) return "ignoredPaths";
  if (lower.includes("ignoredpackages")) return "ignoredPackages";
  if (lower.includes("suppression")) return "suppressions";
  if (lower.includes("schema")) return "schema";
  return "policy";
}

type SuppressionRow = typeof suppressions.$inferSelect;

function tableSuppressionsToPolicy(rows: SuppressionRow[]): PolicySuppression[] {
  // Only rows with an expiry can satisfy validatePolicy's required fields. The POST
  // route enforces expiry, so this filter just protects against legacy/null rows.
  return rows
    .filter((row) => row.expiresAt)
    .map((row) => ({ id: row.id, fingerprint: row.fingerprint || undefined, reason: row.reason, owner: row.createdBy, expiresAt: new Date(row.expiresAt as Date).toISOString() }));
}

async function loadPolicyBase(installationUuid: string): Promise<{ policy: EnforcementPolicy; version: number | null }> {
  if (!db) return { policy: DEFAULT_POLICY, version: null };
  const latest = (await db.select().from(policyVersions).where(eq(policyVersions.installationId, installationUuid)).orderBy(desc(policyVersions.version)).limit(1))[0];
  if (!latest) return { policy: DEFAULT_POLICY, version: null };
  try {
    return { policy: validatePolicy(latest.policy), version: latest.version };
  } catch (error) {
    console.error("Stored policy failed validation, falling back to default:", error);
    return { policy: DEFAULT_POLICY, version: null };
  }
}

// Effective policy actually used to gate a scan: the versioned base policy with the
// suppressions table merged into its suppressions array.
async function loadEffectivePolicy(installationUuid: string): Promise<EnforcementPolicy> {
  const base = await loadPolicyBase(installationUuid);
  if (!db) return base.policy;
  const rows = await db.select().from(suppressions).where(eq(suppressions.installationId, installationUuid));
  try {
    return validatePolicy({ ...base.policy, suppressions: [...base.policy.suppressions, ...tableSuppressionsToPolicy(rows)] });
  } catch {
    return base.policy;
  }
}

// Shared auth gate for the policy routes — mirrors /api/billing/status and
// /api/telemetry/settings exactly (session via getOAuthSession, ownership via
// dashboardInstallation). Writes the error response itself and returns null so the
// caller just returns.
async function resolveDashboardInstallation(req: Request, res: Response, installationId: number): Promise<{ id: string; accountLogin: string } | null> {
  const authorized = await dashboardInstallation(req, installationId);
  if (authorized === null) { res.status(401).json({ ok: false, error: "GitHub login required" }); return null; }
  if (!authorized) { res.status(403).json({ ok: false, error: "Installation is not authorized for this GitHub account" }); return null; }
  if (!db) { res.status(503).json({ ok: false, error: "Database unavailable" }); return null; }
  const installation = (await db.select({ id: installations.id, accountLogin: installations.accountLogin }).from(installations).where(eq(installations.githubInstallationId, installationId)).limit(1))[0];
  if (!installation) { res.status(404).json({ ok: false, error: "Installation not found" }); return null; }
  return installation;
}

// Lets the policy page populate its installation selector regardless of entry point.
app.get("/api/policy/installations", async (req: Request, res: Response) => {
  const session = await getOAuthSession(req);
  if (!session) return res.status(401).json({ ok: false, error: "GitHub login required" });
  if (!db) return res.status(503).json({ ok: false, error: "Database unavailable" });
  try {
    const rows = await db.select({ installationId: installations.githubInstallationId, accountLogin: installations.accountLogin }).from(installations).where(eq(installations.accountLogin, session.login));
    return res.json({ ok: true, installations: rows });
  } catch (error) {
    console.error("Policy installations read failed:", error);
    return res.status(502).json({ ok: false, error: "Could not load installations" });
  }
});

app.get("/api/policy", async (req: Request, res: Response) => {
  const installationId = Number(req.query.installationId);
  if (!Number.isSafeInteger(installationId) || installationId <= 0) return res.status(400).json({ ok: false, error: "Invalid installation ID" });
  try {
    const installation = await resolveDashboardInstallation(req, res, installationId);
    if (!installation) return;
    const base = await loadPolicyBase(installation.id);
    const suppressionRows = await db!.select().from(suppressions).where(eq(suppressions.installationId, installation.id)).orderBy(desc(suppressions.createdAt));
    const versionRows = await db!.select({ version: policyVersions.version, createdBy: policyVersions.createdBy, createdAt: policyVersions.createdAt }).from(policyVersions).where(eq(policyVersions.installationId, installation.id)).orderBy(desc(policyVersions.version)).limit(50);
    let isPro = false;
    try { isPro = await isProActive(installation.accountLogin); }
    catch (error) { console.error("Pro check failed while loading policy, treating as free:", error); isPro = false; }
    return res.json({
      ok: true,
      installationId,
      owner: installation.accountLogin,
      isPro,
      activeVersion: base.version,
      policy: base.policy,
      suppressions: suppressionRows.map((row) => ({ id: row.id, fingerprint: row.fingerprint, reason: row.reason, owner: row.createdBy, expiresAt: row.expiresAt })),
      history: versionRows,
    });
  } catch (error) {
    console.error("Policy read failed:", error);
    return res.status(502).json({ ok: false, error: "Could not load policy" });
  }
});

app.put("/api/policy", async (req: Request, res: Response) => {
  const installationId = Number(req.body?.installationId);
  if (!Number.isSafeInteger(installationId) || installationId <= 0) return res.status(400).json({ ok: false, error: "Invalid installation ID" });
  try {
    const installation = await resolveDashboardInstallation(req, res, installationId);
    if (!installation) return;
    const session = await getOAuthSession(req);
    const actor = session?.login ?? "unknown";

    let validated: EnforcementPolicy;
    try {
      validated = validatePolicy(req.body?.policy);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid policy";
      return res.status(422).json({ ok: false, error: message, field: policyFieldForError(message) });
    }

    // Block-mode enforcement is a paid capability, gated on the same isProActive
    // pattern as the remediation route. Fail closed: any error verifying entitlement
    // must NOT let a block-mode policy be saved.
    if (validated.mode === "block") {
      let pro = false;
      try { pro = await isProActive(installation.accountLogin); }
      catch (error) { console.error(`Pro check failed for ${installation.accountLogin} on policy save, failing closed:`, error); pro = false; }
      if (!pro) {
        return res.status(402).json({ ok: false, status: "upgrade_required", field: "mode", error: "Block mode enforcement requires an active Pro plan. Report mode stays free.", upgradeUrl: `${CANONICAL_BASE_URL}/subscribe?owner=${encodeURIComponent(installation.accountLogin)}&plan=pro` });
      }
    }

    const current = (await db!.select({ version: policyVersions.version }).from(policyVersions).where(eq(policyVersions.installationId, installation.id)).orderBy(desc(policyVersions.version)).limit(1))[0];
    const nextVersion = (current?.version ?? 0) + 1;
    const stored: EnforcementPolicy = { ...validated, suppressions: [], revision: nextVersion, inheritedFrom: current ? `revision:${current.version}` : undefined };

    await db!.insert(policyVersions).values({ installationId: installation.id, version: nextVersion, policy: stored, createdBy: actor });
    const summary = {
      mode: stored.mode,
      minimumSeverity: stored.minimumSeverity,
      blockSecrets: stored.blockCategories.includes("secret"),
      blockMaliciousPackages: stored.blockCategories.includes("dependency"),
      blockDangerousExec: stored.blockCategories.includes("execution"),
      requireCleanBaseline: stored.requireCleanBaseline,
      updatedAt: new Date(),
    };
    await db!.insert(policies).values({ installationId: installation.id, ...summary }).onConflictDoUpdate({ target: policies.installationId, set: summary });

    const audit = policyAuditEvent(stored, actor, current ? "updated" : "created");
    await db!.insert(auditEvents).values({ installationId: installation.id, actor, eventType: "policy.updated", target: `policy:v${nextVersion}${req.body?.repositoryId ? `:repo:${String(req.body.repositoryId)}` : ""}`, metadata: audit });

    return res.json({ ok: true, activeVersion: nextVersion, policy: stored });
  } catch (error) {
    console.error("Policy write failed:", error);
    return res.status(502).json({ ok: false, error: "Could not save policy" });
  }
});

app.get("/api/policy/versions", async (req: Request, res: Response) => {
  const installationId = Number(req.query.installationId);
  if (!Number.isSafeInteger(installationId) || installationId <= 0) return res.status(400).json({ ok: false, error: "Invalid installation ID" });
  try {
    const installation = await resolveDashboardInstallation(req, res, installationId);
    if (!installation) return;
    const rows = await db!.select().from(policyVersions).where(eq(policyVersions.installationId, installation.id)).orderBy(desc(policyVersions.version)).limit(100);
    return res.json({ ok: true, versions: rows.map((row) => ({ version: row.version, createdBy: row.createdBy, createdAt: row.createdAt, mode: (row.policy as EnforcementPolicy)?.mode, minimumSeverity: (row.policy as EnforcementPolicy)?.minimumSeverity, policy: row.policy })) });
  } catch (error) {
    console.error("Policy versions read failed:", error);
    return res.status(502).json({ ok: false, error: "Could not load policy history" });
  }
});

// Live preview: evaluate a proposed policy against the most recent scan run's stored
// findings and return the blocking/suppressed/ignored counts vs. the current policy.
app.post("/api/policy/preview", async (req: Request, res: Response) => {
  const installationId = Number(req.body?.installationId);
  if (!Number.isSafeInteger(installationId) || installationId <= 0) return res.status(400).json({ ok: false, error: "Invalid installation ID" });
  try {
    const installation = await resolveDashboardInstallation(req, res, installationId);
    if (!installation) return;

    let proposed: EnforcementPolicy;
    try { proposed = validatePolicy(req.body?.policy); }
    catch (error) {
      const message = error instanceof Error ? error.message : "Invalid policy";
      return res.status(422).json({ ok: false, error: message, field: policyFieldForError(message) });
    }

    const repoRows = await db!.select({ id: repositories.id }).from(repositories).where(eq(repositories.installationId, installation.id));
    const repoIds = repoRows.map((row) => row.id);
    if (repoIds.length === 0) return res.json({ ok: true, hasRun: false, findings: 0, current: null, proposed: null, delta: 0 });
    const latestRun = (await db!.select().from(scanRuns).where(inArray(scanRuns.repositoryId, repoIds)).orderBy(desc(scanRuns.createdAt)).limit(1))[0];
    if (!latestRun) return res.json({ ok: true, hasRun: false, findings: 0, current: null, proposed: null, delta: 0 });
    const runFindings = await db!.select().from(findings).where(eq(findings.scanRunId, latestRun.id));
    const annotations: ScanAnnotation[] = runFindings.map((f) => ({
      path: f.filePath || "",
      line: f.lineNumber || 0,
      message: f.message,
      title: f.title,
      severity: f.severity === "warning" ? "warning" : "failure",
      category: f.category as ScanAnnotation["category"],
      confidence: "high",
      remediation: f.remediation || "",
      fingerprint: f.fingerprint,
      packageName: f.packageName || undefined,
      ecosystem: f.ecosystem || undefined,
      manifestPath: f.manifestPath || undefined,
    }));

    const tableRows = await db!.select().from(suppressions).where(eq(suppressions.installationId, installation.id));
    const tableSup = tableSuppressionsToPolicy(tableRows);
    const currentBase = await loadPolicyBase(installation.id);
    const currentPolicy = validatePolicy({ ...currentBase.policy, suppressions: [...currentBase.policy.suppressions, ...tableSup] });
    const proposedPolicy = validatePolicy({ ...proposed, suppressions: [...proposed.suppressions, ...tableSup] });

    const summarize = (d: PolicyDecision) => ({ blocking: d.blocking.length, suppressed: d.suppressed.length, ignored: d.ignored.length, shouldBlock: d.shouldBlock, verdict: d.verdict });
    const currentDecision = evaluateGate(annotations, currentPolicy);
    const proposedDecision = evaluateGate(annotations, proposedPolicy);
    return res.json({
      ok: true,
      hasRun: true,
      runId: latestRun.id,
      findings: annotations.length,
      current: summarize(currentDecision),
      proposed: summarize(proposedDecision),
      delta: proposedDecision.blocking.length - currentDecision.blocking.length,
    });
  } catch (error) {
    console.error("Policy preview failed:", error);
    return res.status(502).json({ ok: false, error: "Could not evaluate policy preview" });
  }
});

app.post("/api/policy/suppressions", async (req: Request, res: Response) => {
  const installationId = Number(req.body?.installationId);
  if (!Number.isSafeInteger(installationId) || installationId <= 0) return res.status(400).json({ ok: false, error: "Invalid installation ID" });
  try {
    const installation = await resolveDashboardInstallation(req, res, installationId);
    if (!installation) return;
    const session = await getOAuthSession(req);
    const fingerprint = String(req.body?.fingerprint || "").trim();
    const reason = String(req.body?.reason || "").trim();
    const owner = String(req.body?.owner || "").trim();
    const expiresAt = String(req.body?.expiresAt || "").trim();
    // Mirror validatePolicy's suppression requirements: owner, reason, expiresAt (+
    // fingerprint, which the table requires and the gate matches on).
    if (!fingerprint || !reason || !owner || !expiresAt || Number.isNaN(Date.parse(expiresAt))) {
      return res.status(422).json({ ok: false, error: "Suppression requires fingerprint, owner, reason, and a valid expiry date" });
    }
    const inserted = (await db!.insert(suppressions).values({ installationId: installation.id, fingerprint, reason, expiresAt: new Date(expiresAt), createdBy: owner }).onConflictDoUpdate({ target: [suppressions.installationId, suppressions.fingerprint], set: { reason, expiresAt: new Date(expiresAt), createdBy: owner } }).returning({ id: suppressions.id }))[0];
    await db!.insert(auditEvents).values({ installationId: installation.id, actor: session?.login ?? owner, eventType: "policy.suppression.created", target: `suppression:${fingerprint}`, metadata: { fingerprint, owner, reason, expiresAt } });
    return res.status(201).json({ ok: true, id: inserted?.id });
  } catch (error) {
    console.error("Suppression create failed:", error);
    return res.status(502).json({ ok: false, error: "Could not save suppression" });
  }
});

app.delete("/api/policy/suppressions/:id", async (req: Request, res: Response) => {
  const session = await getOAuthSession(req);
  if (!session) return res.status(401).json({ ok: false, error: "GitHub login required" });
  if (!db) return res.status(503).json({ ok: false, error: "Database unavailable" });
  const id = String(req.params.id || "");
  if (!isUuid(id)) return res.status(404).json({ ok: false, error: "Suppression not found" });
  try {
    const row = (await db.select({ id: suppressions.id, installationUuid: installations.id, accountLogin: installations.accountLogin }).from(suppressions).innerJoin(installations, eq(suppressions.installationId, installations.id)).where(eq(suppressions.id, id)).limit(1))[0];
    if (!row || row.accountLogin.toLowerCase() !== session.login.toLowerCase()) return res.status(404).json({ ok: false, error: "Suppression not found" });
    await db.delete(suppressions).where(eq(suppressions.id, id));
    await db.insert(auditEvents).values({ installationId: row.installationUuid, actor: session.login, eventType: "policy.suppression.deleted", target: `suppression:${id}`, metadata: {} });
    return res.json({ ok: true });
  } catch (error) {
    console.error("Suppression delete failed:", error);
    return res.status(502).json({ ok: false, error: "Could not delete suppression" });
  }
});

/**
 * Renders TERMS.md / PRIVACY.md as a plain readable page. These MUST be reachable ��
 * Gumroad's domain-approval process requires your site to link through to (or contain)
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
  const checkoutEnabled = process.env.GUMROAD_CHECKOUT_ENABLED !== "false";

  const visiblePlans = (Object.keys(plans) as PlanKey[]).filter((key) => key === "pro" || Boolean(plans[key].checkoutUrl()));
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
    checkoutEnabled && !plans.pro.checkoutUrl()
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
    const checkoutUrls = ${JSON.stringify(Object.fromEntries((Object.keys(plans) as PlanKey[]).map((key) => [key, plans[key].checkoutUrl()]))) };
    const planNames = ${JSON.stringify(Object.fromEntries((Object.keys(plans) as PlanKey[]).map((key) => [key, plans[key].name])))};
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
          url.searchParams.set('githubOwner', owner);
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
// the server sees for GUMROAD_CHECKOUT_ENABLED — no guessing whether a typo, stray
// whitespace, or wrong casing is why /subscribe is still showing the waitlist view.
// A value like "true " (trailing space) looks identical to "true" in most UI text
// boxes but has length 5, not 4, and fails the strict === "true" check silently.
app.post("/api/scan", async (req: Request, res: Response) => {
  const expectedToken = process.env.WARDEN_API_TOKEN;
  const suppliedToken = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!expectedToken || suppliedToken !== expectedToken) return res.status(401).json({ ok: false, error: "Unauthorized" });
  const files = Array.isArray(req.body?.files) ? req.body.files as ScannedFile[] : [];
  if (files.length === 0 || files.length > 250) return res.status(400).json({ ok: false, error: "files must contain 1-250 changed files" });
  try {
    const githubRepositoryId = Number(req.body?.githubRepositoryId);
    const commitSha = typeof req.body?.commitSha === "string" ? req.body.commitSha.trim() : "";

    // Resolve repository/installation context up front so a stored policy can drive
    // the scan verdict (via scanFiles -> evaluateGate), not just the built-in default.
    // Best effort: any failure here falls back to the default gate. Block-mode
    // enforcement is a paid capability, so it is coerced to report mode unless Pro is
    // verified live — failing closed means an error never enforces paid blocking and
    // never breaks a CI job over our own outage.
    let effectivePolicy: EnforcementPolicy | undefined;
    let repositoryId: string | undefined;
    if (db && Number.isSafeInteger(githubRepositoryId) && githubRepositoryId > 0) {
      try {
        const repoRow = (await db.select({ id: repositories.id, installationId: repositories.installationId }).from(repositories)
          .where(eq(repositories.githubRepositoryId, githubRepositoryId)).limit(1))[0];
        // No matching repository means the GitHub App isn't installed on this repo —
        // there's no authorized owner to attach a report or policy to.
        if (repoRow) {
          repositoryId = repoRow.id;
          const installation = (await db.select({ id: installations.id, accountLogin: installations.accountLogin }).from(installations).where(eq(installations.id, repoRow.installationId)).limit(1))[0];
          if (installation) {
            const stored = await loadEffectivePolicy(installation.id);
            let policy = stored;
            if (policy.mode === "block") {
              let pro = false;
              try { pro = await isProActive(installation.accountLogin); }
              catch (proError) { console.error(`Could not verify Pro for ${installation.accountLogin} during scan gate, failing closed to report mode:`, proError); pro = false; }
              if (!pro) policy = { ...policy, mode: "report" };
            }
            effectivePolicy = policy;
          }
        }
      } catch (policyError) {
        console.error(JSON.stringify({ event: "scan_policy_load_failed", requestId: res.locals.requestId, error: policyError instanceof Error ? policyError.message : "unknown" }));
      }
    }

    const result = await withTimeout(scanFiles(files, effectivePolicy));
    // Keep the legacy enterprise policy summary in the response for backward
    // compatibility; when a stored policy applies, its gate decision (result.policyDecision)
    // is the source of truth for the persisted verdict.
    const enterprisePolicy = evaluatePolicy(result, defaultScanPolicy);
    const gate = result.policyDecision;
    const verdict = effectivePolicy
      ? (gate.shouldBlock ? "failure" : result.verdict === "incomplete" ? "incomplete" : "success")
      : (enterprisePolicy.verdict === "fail" ? "failure" : result.verdict === "incomplete" ? "incomplete" : "success");

    // Optional: persist this scan so a real, authorized report link can be
    // generated for CI-triggered scans. Persistence is best-effort and never
    // affects the scan/gate result the calling CI job relies on.
    let runId: string | undefined;
    if (db && repositoryId && commitSha) {
      try {
        const inserted = (await db.insert(scanRuns).values({
          repositoryId,
          commitSha,
          status: "completed",
          verdict,
          findingsCount: result.annotations.length,
          startedAt: new Date(),
          completedAt: new Date(),
        }).returning({ id: scanRuns.id }))[0];
        if (inserted) {
          runId = inserted.id;
          if (result.annotations.length > 0) {
            await db.insert(findings).values(result.annotations.map((annotation, index) => ({
              scanRunId: inserted.id,
              fingerprint: annotation.fingerprint || `${annotation.path}:${annotation.line}:${annotation.title}:${index}`,
              severity: annotation.severity,
              category: annotation.category,
              title: annotation.title,
              message: annotation.message,
              remediation: annotation.remediation,
              packageName: annotation.packageName,
              ecosystem: annotation.ecosystem,
              manifestPath: annotation.manifestPath,
              filePath: annotation.path,
              lineNumber: annotation.line,
            })));
          }
        }
      } catch (persistError) {
        console.error(JSON.stringify({ event: "scan_persist_failed", requestId: res.locals.requestId, error: persistError instanceof Error ? persistError.message : "unknown" }));
      }
    }

    const format = String(req.query.format || "json");
    const payload = format === "sarif" ? toSarif(result) : format === "cyclonedx" ? toCycloneDx(result) : { ok: true, ...result, policy: enterprisePolicy, verdict, runId };
    res.type(format === "sarif" ? "application/sarif+json" : "application/json");
    return res.json(JSON.parse(redact(JSON.stringify(payload))));
  } catch (error) {
  console.error(JSON.stringify({ event: "scan_failed", requestId: res.locals.requestId, error: error instanceof Error ? error.message : "unknown" }));
  const timedOut = error instanceof Error && error.message.includes("timed out");
  return res.status(timedOut ? 504 : 500).json({ ok: false, error: timedOut ? "Scan timed out" : "Scan failed", degraded: timedOut });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  const hasRedis = Boolean(process.env.UPSTASH_REDIS_REST_URL?.trim() && process.env.UPSTASH_REDIS_REST_TOKEN?.trim());
  schedulePopularPackageRefresh({ redis: hasRedis ? getRedisClient() : undefined });
});
