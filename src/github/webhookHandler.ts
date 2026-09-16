import { Request, Response } from "express";
import { verifyGithubSignature } from "./verifySignature";
import { processWebhook, validateWebhookIdentity, type WebhookRecord, type WebhookStore } from "./webhookLifecycle";

const ACTIONABLE_ACTIONS = new Set(["opened", "synchronize", "reopened"]);

export interface WebhookProcessorDependencies {
  store: WebhookStore;
  process: (payload: unknown, deliveryId: string) => Promise<void>;
}

export function createWebhookHandler({ store, process: processEvent }: WebhookProcessorDependencies) {
  return async function handleWebhook(req: Request, res: Response): Promise<void> {
    const secret = globalThis.process?.env?.GITHUB_WEBHOOK_SECRET;
    if (!secret) { res.status(500).send("Webhook secret not configured"); return; }
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(String(req.body ?? ""));
    const signature = req.headers["x-hub-signature-256"] as string | undefined;
    if (!rawBody.length || !verifyGithubSignature(rawBody, signature, secret)) { res.status(401).send("Invalid signature"); return; }
    const event = String(req.headers["x-github-event"] ?? "");
    const deliveryId = String(req.headers["x-github-delivery"] ?? "").trim();
    const identity = validateWebhookIdentity({ deliveryId, event, rawBody });
    if (!identity) { res.status(400).send("Missing webhook identity"); return; }
    if (event !== "pull_request") { res.status(204).send(); return; }
    let payload: any;
    try { payload = JSON.parse(rawBody.toString("utf8")); } catch { res.status(400).send("Invalid payload"); return; }
    if (!ACTIONABLE_ACTIONS.has(payload?.action)) { res.status(204).send(); return; }
    const record: WebhookRecord = {
      ...identity,
      installationId: payload.installation?.id ? String(payload.installation.id) : undefined,
      repositoryId: payload.repository?.id ? String(payload.repository.id) : undefined,
      occurredAt: payload.repository?.updated_at,
      status: "received",
      attempt: 1,
    };
    const claim = await store.claim(record);
    if (claim !== "claimed") { res.status(204).send(); return; }
    res.status(202).send();
    try {
      await processWebhook(store, record, () => processEvent(payload, deliveryId));
    } catch (error) {
      console.error(JSON.stringify({ event: "webhook_processing_failed", deliveryId, error: error instanceof Error ? error.message : "unknown" }));
    }
  };
}

export async function handlePullRequestWebhook(req: Request, res: Response): Promise<void> {
  throw new Error("handlePullRequestWebhook requires durable dependencies; use createWebhookHandler");
}
