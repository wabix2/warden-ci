import assert from "node:assert/strict";
import test from "node:test";
import { authorizeRunAccessWithDependencies } from "../dist/auth/runAccess.js";

const runId = "11111111-1111-4111-8111-111111111111";
const run = { id: runId, repositoryId: "repo", commitSha: "sha", findingsCount: 0 };
function request(cookie) { return { headers: cookie ? { cookie } : {} }; }
function database(row) {
  const query = { from() { return query; }, innerJoin() { return query; }, where() { return query; }, limit: async () => row ? [{ run, githubInstallationId: row }] : [] };
  return { select() { return query; } };
}
function deps(installation, status = 200, token = "oauth-token") {
  return { database: database(installation), sessionToken: async () => token, githubFetch: async (url, init) => {
    assert.equal(url, `https://api.github.com/user/installations/${installation}`);
    assert.equal(init.headers.Authorization, `Bearer ${token}`);
    return new Response(null, { status });
  } };
}

test("AUTH-1 no session is unauthenticated", async () => assert.equal((await authorizeRunAccessWithDependencies(request(), runId, deps(7))).kind, "unauthenticated"));
test("AUTH-2 authorized installation returns the run", async () => assert.equal((await authorizeRunAccessWithDependencies(request("warden_session=s"), runId, deps(7))).kind, "authorized"));
test("AUTH-3 different installation is forbidden", async () => assert.equal((await authorizeRunAccessWithDependencies(request("warden_session=s"), runId, deps(7, 403))).kind, "forbidden"));
test("AUTH-4 missing run is not found", async () => assert.equal((await authorizeRunAccessWithDependencies(request("warden_session=s"), runId, deps(null))).kind, "not_found"));
test("AUTH-5 installation B cannot be accessed by installation A user", async () => assert.equal((await authorizeRunAccessWithDependencies(request("warden_session=s"), runId, deps(22, 404))).kind, "forbidden"));
test("AUTH-6 client installation values are ignored", async () => assert.equal((await authorizeRunAccessWithDependencies({ headers: { cookie: "warden_session=s" }, query: { installationId: "7" } }, runId, deps(22, 403))).kind, "forbidden"));
test("AUTH-7 expired session fails closed", async () => assert.equal((await authorizeRunAccessWithDependencies(request("warden_session=expired"), runId, { ...deps(7), sessionToken: async () => null })).kind, "unauthenticated"));
test("AUTH-8 malformed, random, and sequential IDs never authorize", async () => {
  assert.equal((await authorizeRunAccessWithDependencies(request("warden_session=s"), "123", deps(7))).kind, "not_found");
  assert.equal((await authorizeRunAccessWithDependencies(request("warden_session=s"), "22222222-2222-4222-8222-222222222222", deps(null))).kind, "not_found");
});
