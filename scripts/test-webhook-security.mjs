import assert from "node:assert/strict";
import test from "node:test";
import { createHmac } from "node:crypto";
import { verifyGithubSignature } from "../dist/github/verifySignature.js";

const secret = "test-webhook-secret";
const body = Buffer.from(JSON.stringify({ action: "opened", installation: { id: 7 } }));
const signature = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

test("valid GitHub signature is accepted", () => assert.equal(verifyGithubSignature(body, signature, secret), true));
test("missing signature is rejected", () => assert.equal(verifyGithubSignature(body, undefined, secret), false));
test("modified body is rejected", () => assert.equal(verifyGithubSignature(Buffer.from(`${body.toString()} `), signature, secret), false));
test("modified signature is rejected", () => assert.equal(verifyGithubSignature(body, `${signature.slice(0, -1)}0`, secret), false));
test("wrong secret is rejected", () => assert.equal(verifyGithubSignature(body, signature, "wrong-secret"), false));
test("empty payload is rejected", () => assert.equal(verifyGithubSignature(Buffer.alloc(0), signature, secret), false));
