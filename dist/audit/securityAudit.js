"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordSecurityAudit = recordSecurityAudit;
const db_1 = require("../db");
const schema_1 = require("../db/schema");
async function recordSecurityAudit(input) {
    if (!db_1.db)
        return;
    await db_1.db.insert(schema_1.auditEvents).values({
        installationId: input.installationId,
        eventType: input.eventType,
        actor: input.actor,
        target: input.target,
        metadata: input.metadata || {},
    });
}
