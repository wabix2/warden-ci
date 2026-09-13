import test from "node:test";
import assert from "node:assert/strict";

const source = await import("../dist/billing/store.js");

test("billing store exports Pro lifecycle operations", () => {
  assert.equal(typeof source.setProStatus, "function");
  assert.equal(typeof source.getProRecord, "function");
  assert.equal(typeof source.isProActive, "function");
});
