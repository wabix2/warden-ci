import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeCorpusInput, corpusRetention } from "../dist/telemetry/corpusLog.js";

test("corpus event contains only disclosed fields", () => {
  const event = sanitizeCorpusInput({
    ecosystem: "npm",
    packageName: "left-pad",
    verdict: "typosquat-suspect",
    impersonating: "lodash",
    timestamp: "2026-09-12T00:00:00.000Z",
    repository: "must-not-cross-boundary",
  });
  assert.deepEqual(event, {
    ecosystem: "npm",
    packageName: "left-pad",
    verdict: "typosquat-suspect",
    impersonating: "lodash",
    timestamp: "2026-09-12T00:00:00.000Z",
  });
  assert.equal("repository" in event, false);
});

test("retention is finite and documented", () => {
  assert.equal(corpusRetention.rawEventDays, 90);
  assert.equal(corpusRetention.aggregateDays, 365);
});
