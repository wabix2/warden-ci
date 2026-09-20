"use strict";
/**
 * Thin HTTP client for the Warden backend.
 *
 * Kept `vscode`-free and with an injectable `fetch` so it can be unit tested with a
 * mocked network. All package-risk logic is server-side; this just carries a package
 * name + ecosystem there and reads the verdict back.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkPackage = checkPackage;
exports.fetchCliStatus = fetchCliStatus;
exports.pollCliSession = pollCliSession;
function trimBase(serverUrl) {
    return serverUrl.replace(/\/+$/, "");
}
async function checkPackage(serverUrl, ecosystem, name, fetchImpl = fetch, signal) {
    const url = `${trimBase(serverUrl)}/api/check/package?ecosystem=${encodeURIComponent(ecosystem)}&name=${encodeURIComponent(name)}`;
    const response = await fetchImpl(url, { signal });
    if (!response.ok)
        throw new Error(`Warden package check failed (${response.status})`);
    return (await response.json());
}
async function fetchCliStatus(serverUrl, token, fetchImpl = fetch) {
    const response = await fetchImpl(`${trimBase(serverUrl)}/api/cli/status`, {
        headers: { Cookie: `warden_session=${token}` },
    });
    if (response.status === 401)
        return { ok: false };
    if (!response.ok)
        throw new Error(`Warden status check failed (${response.status})`);
    return (await response.json());
}
async function pollCliSession(serverUrl, state, fetchImpl = fetch) {
    const response = await fetchImpl(`${trimBase(serverUrl)}/api/cli/session?state=${encodeURIComponent(state)}`);
    if (!response.ok)
        throw new Error(`Warden sign-in poll failed (${response.status})`);
    return (await response.json());
}
