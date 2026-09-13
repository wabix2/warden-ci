import { db } from "../db";
import { auditEvents } from "../db/schema";

export async function recordSecurityAudit(input: {
  installationId: string;
  eventType: string;
  actor: string;
  target?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  if (!db) return;
  await db.insert(auditEvents).values({
    installationId: input.installationId,
    eventType: input.eventType,
    actor: input.actor,
    target: input.target,
    metadata: input.metadata || {},
  });
}
