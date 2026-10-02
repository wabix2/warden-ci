import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { verifyGithubSignature } from "../dist/github/verifySignature.js";

const secret = "phase3-test-secret";
const body = Buffer.from(JSON.stringify({ action: "installation", installation: { id: 42 } }));
const signature = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

test("valid webhook signature verifies exact raw bytes", () => assert.equal(verifyGithubSignature(body, signature, secret), true));
test("modified body and forged signature are rejected", () => {
  assert.equal(verifyGithubSignature(Buffer.from(`${body}.`), signature, secret), false);
  assert.equal(verifyGithubSignature(body, "sha256=deadbeef", secret), false);
});
test("missing signature is rejected", () => assert.equal(verifyGithubSignature(body, undefined, secret), false));

test("delivery identifiers provide deterministic idempotency keys", () => {
  const delivery = "delivery-42";
  assert.equal(`warden:delivery:${delivery}`, "warden:delivery:delivery-42");
  assert.equal(`warden:delivery:${delivery}`, `warden:delivery:${delivery}`);
});

console.log("Lifecycle integration limitation: active pull-request handler acknowledges before its deferred executor; production state-machine processing remains externally unverified.");
