import test from "node:test";
import assert from "node:assert/strict";
import { checkPackage, fetchCliStatus, pollCliSession } from "../out/client.js";

const BASE = "https://warden.example.com";

function mockFetch(handler) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url: String(url), init });
    return handler(String(url), init);
  };
  fn.calls = calls;
  return fn;
}

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

test("checkPackage builds the query and returns the parsed verdict", async () => {
  const fetchMock = mockFetch(() => jsonResponse(200, { ok: true, flagged: true, verdict: "hallucinated", name: "faaker" }));
  const result = await checkPackage(`${BASE}/`, "npm", "faaker", fetchMock);
  assert.equal(fetchMock.calls[0].url, `${BASE}/api/check/package?ecosystem=npm&name=faaker`);
  assert.equal(result.flagged, true);
  assert.equal(result.verdict, "hallucinated");
});

test("checkPackage url-encodes scoped names", async () => {
  const fetchMock = mockFetch(() => jsonResponse(200, { ok: true, flagged: false }));
  await checkPackage(BASE, "npm", "@scope/pkg", fetchMock);
  assert.match(fetchMock.calls[0].url, /name=%40scope%2Fpkg$/);
});

test("checkPackage throws on a non-ok response", async () => {
  const fetchMock = mockFetch(() => jsonResponse(500, {}));
  await assert.rejects(() => checkPackage(BASE, "npm", "x", fetchMock), /failed \(500\)/);
});

test("fetchCliStatus sends the session cookie and parses status", async () => {
  const fetchMock = mockFetch(() => jsonResponse(200, { ok: true, pro: true, login: "octocat" }));
  const status = await fetchCliStatus(BASE, "sess-123", fetchMock);
  assert.equal(fetchMock.calls[0].init.headers.Cookie, "warden_session=sess-123");
  assert.equal(status.pro, true);
});

test("fetchCliStatus treats 401 as signed-out", async () => {
  const fetchMock = mockFetch(() => jsonResponse(401, {}));
  const status = await fetchCliStatus(BASE, "expired", fetchMock);
  assert.deepEqual(status, { ok: false });
});

test("pollCliSession returns pending then the token", async () => {
  let call = 0;
  const fetchMock = mockFetch(() => (call++ === 0 ? jsonResponse(200, { ok: true, pending: true }) : jsonResponse(200, { ok: true, pending: false, token: "tok" })));
  assert.equal((await pollCliSession(BASE, "abc", fetchMock)).pending, true);
  assert.equal((await pollCliSession(BASE, "abc", fetchMock)).token, "tok");
});
