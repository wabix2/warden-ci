#!/usr/bin/env node

import { createHmac } from "node:crypto";

const secret = process.env.GITHUB_WEBHOOK_SECRET;
if (!secret) {
  throw new Error("GITHUB_WEBHOOK_SECRET must be set");
}

const baseUrl = process.env.TEST_WEBHOOK_BASE_URL || `http://127.0.0.1:${process.env.PORT || 3000}`;
const installationId = Number(process.env.GITHUB_TEST_INSTALLATION_ID || 0);
const owner = process.env.GITHUB_TEST_OWNER || "example-owner";
const repo = process.env.GITHUB_TEST_REPO || "example-repo";
const prNumber = Number(process.env.GITHUB_TEST_PR_NUMBER || 1);
const headSha = process.env.GITHUB_TEST_HEAD_SHA || "0000000000000000000000000000000000000000";

const payload = {
  action: "opened",
  installation: { id: installationId },
  repository: {
    name: repo,
    private: false,
    owner: { login: owner },
  },
  pull_request: {
    number: prNumber,
    head: { sha: headSha },
  },
};

const body = JSON.stringify(payload);
const signature = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
const response = await fetch(new URL("/api/github/webhooks", baseUrl), {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-github-event": "pull_request",
    "x-hub-signature-256": signature,
  },
  body,
});

const responseText = await response.text();
if (response.status !== 202) {
  throw new Error(`Webhook was not accepted (${response.status}): ${responseText}`);
}

console.log(`Signed pull_request webhook accepted by ${baseUrl}/api/github/webhooks.`);
console.log("The handler has started the asynchronous GitHub scan pipeline.");
console.log(`Test payload: ${owner}/${repo}#${prNumber} at ${headSha}`);