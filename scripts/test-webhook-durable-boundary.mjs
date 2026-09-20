import assert from "node:assert/strict";
import { processWebhook } from "../dist/github/webhookLifecycle.js";

class Store {
  records = new Map();
  async claim(record) {
    const current = this.records.get(record.deliveryId);
    if (current?.status === "processed" || current?.status === "processing") return "duplicate";
    this.records.set(record.deliveryId, { ...record, status: "processing" });
    return "claimed";
  }
  async markProcessed(id) { this.records.get(id).status = "processed"; }
  async markFailed(id, error) { this.records.get(id).status = "failed"; this.records.get(id).error = error; }
}

const base = { deliveryId: "d-1", event: "pull_request", fingerprint: "f", status: "received", attempt: 1, installationId: "i-a", repositoryId: "r-a" };
const store = new Store();
let effects = 0;
await processWebhook(store, base, async () => { effects += 1; });
await processWebhook(store, base, async () => { effects += 1; });
assert.equal(effects, 1);
assert.equal(store.records.get("d-1").status, "processed");

const retryStore = new Store();
let attempts = 0;
await assert.rejects(() => processWebhook(retryStore, { ...base, deliveryId: "d-2" }, async () => { attempts += 1; throw new Error("crash"); }));
assert.equal(retryStore.records.get("d-2").status, "failed");
retryStore.records.delete("d-2");
await processWebhook(retryStore, { ...base, deliveryId: "d-2", attempt: 2 }, async () => { attempts += 1; });
assert.equal(attempts, 2);
assert.equal(retryStore.records.get("d-2").status, "processed");
console.log("durable webhook boundary: PASS");
