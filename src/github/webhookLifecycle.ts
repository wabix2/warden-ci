import { createHash } from "node:crypto";

export type WebhookStatus = "received" | "processing" | "processed" | "failed";

export interface WebhookRecord {
  deliveryId: string;
  event: string;
  installationId?: string;
  repositoryId?: string;
  occurredAt?: string;
  status: WebhookStatus;
  attempt: number;
  fingerprint: string;
  error?: string;
}

export interface WebhookStore {
  claim(record: WebhookRecord): Promise<"claimed" | "duplicate" | "stale">;
  markProcessed(deliveryId: string): Promise<void>;
  markFailed(deliveryId: string, error: string): Promise<void>;
}

export function webhookFingerprint(rawBody: Buffer): string {
  return createHash("sha256").update(rawBody).digest("hex");
}

export function validateWebhookIdentity(input: { deliveryId?: string; event?: string; rawBody: Buffer }): { deliveryId: string; event: string; fingerprint: string } | null {
  const deliveryId = String(input.deliveryId ?? "").trim();
  const event = String(input.event ?? "").trim();
  if (!deliveryId || !event || input.rawBody.length === 0) return null;
  return { deliveryId, event, fingerprint: webhookFingerprint(input.rawBody) };
}

export async function processWebhook<T>(store: WebhookStore, record: WebhookRecord, work: () => Promise<T>): Promise<{ status: "processed" | "duplicate"; value?: T }> {
  const claim = await store.claim(record);
  if (claim === "duplicate" || claim === "stale") return { status: "duplicate" };
  try {
    const value = await work();
    await store.markProcessed(record.deliveryId);
    return { status: "processed", value };
  } catch (error) {
    await store.markFailed(record.deliveryId, error instanceof Error ? error.message : "unknown webhook failure");
    throw error;
  }
}
