import assert from "node:assert/strict";
import test from "node:test";
import { buildSafeDraft, parseOptInAudience } from "../dist/outreach/audience.js";

test("audience parser normalizes, deduplicates, and requires consent", () => {
  const rows = parseOptInAudience("email,name,company,consent\nA@example.com,Alice,Acme,yes\na@example.com,Alice,Acme,yes");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].email, "a@example.com");
  assert.throws(() => parseOptInAudience("bad@example.com,Bad,Acme,no"), /Consent is required/);
});

test("draft sanitizes supplied context and includes unsubscribe instruction", () => {
  const draft = buildSafeDraft({ name: "<Alice>", company: "Acme", product: "Warden CI" });
  assert.equal(draft.html.includes("<Alice>"), false);
  assert.match(draft.html, /unsubscribe/);
});
