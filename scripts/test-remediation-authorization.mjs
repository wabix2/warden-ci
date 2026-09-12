import assert from "node:assert/strict";
import test from "node:test";
import { authorizeInstallationRepositoryWrite } from "../dist/auth/runAccess.js";

const response = (repositories, status = 200) => async () => status === 200 ? new Response(JSON.stringify({ repositories }), { status, headers: { "content-type": "application/json" } }) : new Response(null, { status });
const repo = (permissions) => ({ id: 42, permissions });

test("write authorization requires exact repository pull and push", async () => {
  assert.equal(await authorizeInstallationRepositoryWrite("t", 7, 42, response([repo({ pull: true, push: true })])), "authorized");
  assert.equal(await authorizeInstallationRepositoryWrite("t", 7, 42, response([repo({ pull: true, push: false })])), "forbidden");
  assert.equal(await authorizeInstallationRepositoryWrite("t", 7, 42, response([repo({ pull: false, push: true })])), "forbidden");
});

test("write authorization rejects unrelated repositories and malformed IDs", async () => {
  assert.equal(await authorizeInstallationRepositoryWrite("t", 7, 42, response([{ id: 99, permissions: { pull: true, push: true } }])), "forbidden");
  assert.equal(await authorizeInstallationRepositoryWrite("t", 0, 42, response([])), "forbidden");
  assert.equal(await authorizeInstallationRepositoryWrite("t", 7, 0, response([])), "forbidden");
});

test("GitHub failures fail closed", async () => {
  await assert.rejects(() => authorizeInstallationRepositoryWrite("t", 7, 42, response([], 401)));
  await assert.rejects(() => authorizeInstallationRepositoryWrite("t", 7, 42, response([], 403)));
  await assert.rejects(() => authorizeInstallationRepositoryWrite("t", 7, 42, response([], 404)));
});
