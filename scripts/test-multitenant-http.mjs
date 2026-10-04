import test from "node:test";
import assert from "node:assert/strict";
import { authorizeInstallationRepository, authorizeInstallationRepositoryWrite, authorizeRunAccessWithDependencies } from "../dist/auth/runAccess.js";

function request(session = "A") {
  return { headers: { cookie: `warden_session=${session.repeat(32)}` } };
}
function githubFetchFor(allowedRepositoryId, permission = { pull: true, push: true }) {
  return async () => new Response(JSON.stringify({ repositories: [{ id: allowedRepositoryId, permissions: permission }], total_count: 1 }), { status: 200, headers: { "content-type": "application/json" } });
}

test("tenant A cannot authorize tenant B repository through identifier substitution", async () => {
  assert.equal(await authorizeInstallationRepository("token-a", 10, 20, githubFetchFor(30)), "forbidden");
});

test("tenant A can access only the repository returned by its GitHub installation", async () => {
  assert.equal(await authorizeInstallationRepository("token-a", 10, 20, githubFetchFor(20)), "authorized");
});

test("write access requires both pull and push permissions", async () => {
  assert.equal(await authorizeInstallationRepositoryWrite("token-a", 10, 20, githubFetchFor(20, { pull: true, push: false })), "forbidden");
});

test("run access maps missing database rows to not_found without leaking ownership", async () => {
  const database = { select() { return this; }, from() { return this; }, innerJoin() { return this; }, where() { return this; }, limit: async () => [] };
  const result = await authorizeRunAccessWithDependencies(request(), "00000000-0000-4000-8000-000000000001", { database, sessionToken: async () => "token", githubFetch: githubFetchFor(20) });
  assert.deepEqual(result, { kind: "not_found" });
});
