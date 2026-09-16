import { and, eq, lt, or } from "drizzle-orm";
import { db, requireDb } from "../db";
import { githubWebhookEvents } from "../db/schema";
import type { WebhookRecord, WebhookStore } from "./webhookLifecycle";

const MAX_ATTEMPTS = 5;

export function createDurableWebhookStore(database = db): WebhookStore {
  return {
    async claim(record: WebhookRecord) {
      if (!database) throw new Error("DATABASE_URL is not configured");
      const existing = await database.select().from(githubWebhookEvents).where(eq(githubWebhookEvents.deliveryId, record.deliveryId)).limit(1);
      const current = existing[0];
      if (current?.status === "processed" || current?.status === "processing" || current?.status === "received") return "duplicate";
      if (current?.attempt && current.attempt >= MAX_ATTEMPTS) return "stale";
      if (current) {
        await database.update(githubWebhookEvents).set({ status: "processing", attempt: current.attempt + 1, error: null, updatedAt: new Date() }).where(eq(githubWebhookEvents.deliveryId, record.deliveryId));
        return "claimed";
      }
      await database.insert(githubWebhookEvents).values({
        deliveryId: record.deliveryId,
        event: record.event,
        installationId: record.installationId ? Number(record.installationId) : null,
        repositoryId: record.repositoryId ? Number(record.repositoryId) : null,
        occurredAt: record.occurredAt ? new Date(record.occurredAt) : null,
        fingerprint: record.fingerprint,
        status: "processing",
        attempt: 1,
      });
      return "claimed";
    },
    async markProcessed(deliveryId) {
      if (!database) throw new Error("DATABASE_URL is not configured");
      await database.update(githubWebhookEvents).set({ status: "processed", updatedAt: new Date(), processedAt: new Date() }).where(eq(githubWebhookEvents.deliveryId, deliveryId));
    },
    async markFailed(deliveryId, error) {
      if (!database) throw new Error("DATABASE_URL is not configured");
      await database.update(githubWebhookEvents).set({ status: "failed", error: error.slice(0, 2000), updatedAt: new Date() }).where(eq(githubWebhookEvents.deliveryId, deliveryId));
    },
  };
}

export async function persistWebhookBeforeAck(record: WebhookRecord): Promise<"claimed" | "duplicate" | "stale"> {
  return createDurableWebhookStore(requireDb()).claim(record);
}
