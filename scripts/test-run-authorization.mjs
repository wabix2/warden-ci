import assert from "node:assert/strict";
import test from "node:test";
import { authorizeRunAccessWithDependencies } from "../dist/auth/runAccess.js";

const runId = "11111111-1111-4111-8111-111111111111";
const run = { id: runId, repositoryId: "repo", commitSha: "sha", findingsCount: 0 };
function request(cookie, query = {}) { return { headers: cookie ? { cookie } : {}, query }; }
function database(row) {
  const query = { from() { return query; }, innerJoin() { return query; }, where() { return query; }, limit: async () => row ? [{ run, githubInstallationId: row.installationId, githubRepositoryId: row.repositoryId }] : [] };
  return { select() { return query; } };
}
function deps(row, pages, status = 200, token = "oauth-token") {
  let calls = 0;
  return { database: database(row), sessionToken: async () => token, githubFetch: async (url, init) => {
    calls += 1;
    assert.match(url, new RegExp(`https://api\\.github\\.com/user/installations/${row?.installationId || "\\d+"}/repositories\\?`));
    assert.match(url, /per_page=100&page=\d+/);
    assert.equal(init.headers.Authorization, `Bearer ${token}`);
    if (status !== 200) return new Response(null, { status });
    return new Response(JSON.stringify(pages[calls - 1] || { repositories: [] }), { status: 200, headers: { "content-type": "application/json" } });
  } };
}
const allowed = { installationId: 7, repositoryId: 101 };
const repo = (id, pull = true) => ({ id, permissions: { pull, push: false, admin: false } });

test("AUTH-1 no session is unauthenticated", async () => assert.equal((await authorizeRunAccessWithDependencies(request(), runId, deps(allowed, [{ repositories: [repo(101)] }]))).kind, "unauthenticated"));
test("AUTH-2 exact repository with pull permission is authorized", async () => assert.equal((await authorizeRunAccessWithDependencies(request("warden_session=s"), runId, deps(allowed, [{ repositories: [repo(101)] }]))).kind, "authorized"));
test("AUTH-3 different installation is forbidden", async () => assert.equal((await authorizeRunAccessWithDependencies(request("warden_session=s"), runId, deps({ installationId: 22, repositoryId: 202 }, [{ repositories: [repo(101)] }]))).kind, "forbidden"));
test("AUTH-4 missing run is not found", async () => assert.equal((await authorizeRunAccessWithDependencies(request("warden_session=s"), runId, deps(null, []))).kind, "not_found"));
test("AUTH-5 user cannot access another installation repository", async () => assert.equal((await authorizeRunAccessWithDependencies(request("warden_session=s"), runId, deps({ installationId: 22, repositoryId: 202 }, [{ repositories: [repo(101)] }]))).kind, "forbidden"));
test("AUTH-6 client installation values cannot change server ownership", async () => assert.equal((await authorizeRunAccessWithDependencies(request("warden_session=s", { installationId: "7" }), runId, deps({ installationId: 22, repositoryId: 202 }, [{ repositories: [repo(202)] }]))).kind, "authorized"));
test("AUTH-7 repository absent from accessible response is forbidden", async () => assert.equal((await authorizeRunAccessWithDependencies(request("warden_session=s"), runId, deps(allowed, [{ repositories: [repo(999)] }]))).kind, "forbidden"));
test("AUTH-8 insufficient repository permission is forbidden", async () => assert.equal((await authorizeRunAccessWithDependencies(request("warden_session=s"), runId, deps(allowed, [{ repositories: [repo(101, false)] }]))).kind, "forbidden"));
test("GitHub 401 is unauthenticated", async () => assert.equal((await authorizeRunAccessWithDependencies(request("warden_session=s"), runId, deps(allowed, [], 401))).kind, "unauthenticated"));
test("GitHub 403 and 404 fail closed", async () => {
  assert.equal((await authorizeRunAccessWithDependencies(request("warden_session=s"), runId, deps(allowed, [], 403))).kind, "forbidden");
  assert.equal((await authorizeRunAccessWithDependencies(request("warden_session=s"), runId, deps(allowed, [], 404))).kind, "forbidden");
});
test("pagination finds the exact repository", async () => {
  const result = await authorizeRunAccessWithDependencies(request("warden_session=s"), runId, deps(allowed, [{ repositories: Array(100).fill(null).map((_, i) => repo(i + 1)), total_count: 101 }, { repositories: [repo(101)], total_count: 101 }]));
  assert.equal(result.kind, "authorized");
});
test("invalid GitHub response fails closed", async () => await assert.rejects(() => authorizeRunAccessWithDependencies(request("warden_session=s"), runId, deps(allowed, [{}]))));
test("malformed and random IDs never authorize", async () => {
  assert.equal((await authorizeRunAccessWithDependencies(request("warden_session=s"), "123", deps(allowed, []))).kind, "not_found");
  assert.equal((await authorizeRunAccessWithDependencies(request("warden_session=s"), "22222222-2222-4222-8222-222222222222", deps(null, []))).kind, "not_found");
});
test("expired session fails closed", async () => assert.equal((await authorizeRunAccessWithDependencies(request("warden_session=expired"), runId, { ...deps(allowed, [{ repositories: [repo(101)] }]), sessionToken: async () => null })).kind, "unauthenticated"));
