"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getGumroadApiToken = getGumroadApiToken;
exports.verifyGumroadSale = verifyGumroadSale;
// Loaded dynamically so the existing CommonJS TypeScript target can use the
// Connect SDK without changing the server module system.
const { getToken } = require("@vercel/connect");
const CONNECTOR_UID = "gumroad.com/warden-pro-billing";
async function getGumroadApiToken() {
    const result = await getToken(CONNECTOR_UID, { subject: { type: "app" } });
    return result.token;
}
async function verifyGumroadSale(saleId) {
    const token = await getGumroadApiToken();
    const response = await fetch(`https://api.gumroad.com/v2/sales/${encodeURIComponent(saleId)}`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok)
        throw new Error(`Gumroad verification failed (${response.status})`);
    return response.json();
}
