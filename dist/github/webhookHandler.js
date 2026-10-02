"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createWebhookHandler = createWebhookHandler;
exports.handlePullRequestWebhook = handlePullRequestWebhook;
const verifySignature_1 = require("./verifySignature");
const webhookLifecycle_1 = require("./webhookLifecycle");
const ACTIONABLE_ACTIONS = new Set(["opened", "synchronize", "reopened"]);
function createWebhookHandler({ store, process: processEvent }) {
    return async function handleWebhook(req, res) {
        const secret = globalThis.process?.env?.GITHUB_WEBHOOK_SECRET;
        if (!secret) {
            res.status(500).send("Webhook secret not configured");
            return;
        }
        const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(String(req.body ?? ""));
        const signature = req.headers["x-hub-signature-256"];
        if (!rawBody.length || !(0, verifySignature_1.verifyGithubSignature)(rawBody, signature, secret)) {
            res.status(401).send("Invalid signature");
            return;
        }
        const event = String(req.headers["x-github-event"] ?? "");
        const deliveryId = String(req.headers["x-github-delivery"] ?? "").trim();
        const identity = (0, webhookLifecycle_1.validateWebhookIdentity)({ deliveryId, event, rawBody });
        if (!identity) {
            res.status(400).send("Missing webhook identity");
            return;
        }
        if (event !== "pull_request") {
            res.status(204).send();
            return;
        }
        let payload;
        try {
            payload = JSON.parse(rawBody.toString("utf8"));
        }
        catch {
            res.status(400).send("Invalid payload");
            return;
        }
        if (!ACTIONABLE_ACTIONS.has(payload?.action)) {
            res.status(204).send();
            return;
        }
        const record = {
            ...identity,
            installationId: payload.installation?.id ? String(payload.installation.id) : undefined,
            repositoryId: payload.repository?.id ? String(payload.repository.id) : undefined,
            occurredAt: payload.repository?.updated_at,
            status: "received",
            attempt: 1,
        };
        const claim = await store.claim(record);
        if (claim !== "claimed") {
            res.status(204).send();
            return;
        }
        res.status(202).send();
        try {
            await (0, webhookLifecycle_1.processWebhook)(store, record, () => processEvent(payload, deliveryId));
        }
        catch (error) {
            console.error(JSON.stringify({ event: "webhook_processing_failed", deliveryId, error: error instanceof Error ? error.message : "unknown" }));
        }
    };
}
async function handlePullRequestWebhook(req, res) {
    throw new Error("handlePullRequestWebhook requires durable dependencies; use createWebhookHandler");
}
