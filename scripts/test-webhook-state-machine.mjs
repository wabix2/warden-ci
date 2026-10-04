import assert from "node:assert/strict";
import { processWebhook, validateWebhookIdentity } from "../dist/github/webhookLifecycle.js";

class MemoryStore {
  records = new Map();
  async claim(record) { if (this.records.has(record.deliveryId)) return "duplicate"; this.records.set(record.deliveryId, { ...record, status: "processing" }); return "claimed"; }
  async markProcessed(id) { this.records.get(id).status = "processed"; }
  async markFailed(id, error) { this.records.get(id).status = "failed"; this.records.get(id).error = error; }
}

const raw = Buffer.from('{"action":"opened"}');
const identity = validateWebhookIdentity({ deliveryId: "delivery-a", event: "pull_request", rawBody: raw });
assert.ok(identity);
const store = new MemoryStore();
let sideEffects = 0;
const record = { ...identity, status: "received", attempt: 1 };
const first = await processWebhook(store, record, async () => { sideEffects += 1; return "ok"; });
const duplicate = await processWebhook(store, record, async () => { sideEffects += 1; return "bad"; });
assert.equal(first.status, "processed");
assert.equal(duplicate.status, "duplicate");
assert.equal(sideEffects, 1);
assert.equal(store.records.get("delivery-a").status, "processed");

const failedStore = new MemoryStore();
await assert.rejects(() => processWebhook(failedStore, { ...record, deliveryId: "delivery-b" }, async () => { throw new Error("temporary"); }));
assert.equal(failedStore.records.get("delivery-b").status, "failed");
console.log("webhook state machine: PASS");
