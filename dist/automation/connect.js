"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getGmailToken = getGmailToken;
exports.startGmailAuthorization = startGmailAuthorization;
exports.getResendToken = getResendToken;
exports.sendGmailCampaignEmail = sendGmailCampaignEmail;
exports.sendApprovedEmail = sendApprovedEmail;
// Loaded dynamically because this project compiles CommonJS with legacy module resolution.
const { getToken, startAuthorization } = require("@vercel/connect");
const GMAIL_CONNECTOR = "google/warden-support-gmail";
const RESEND_CONNECTOR = "api.resend.com/warden-support-email";
async function getGmailToken(subjectId) {
    return getToken(GMAIL_CONNECTOR, { subject: { type: "user", id: subjectId } });
}
async function startGmailAuthorization(subjectId, callbackUrl) {
    const result = await startAuthorization(GMAIL_CONNECTOR, { subject: { type: "user", id: subjectId }, scopes: ["https://www.googleapis.com/auth/gmail.send"] }, { callbackUrl });
    return result.url;
}
async function getResendToken() {
    return getToken(RESEND_CONNECTOR, { subject: { type: "app" } });
}
async function sendGmailCampaignEmail(input) {
    const token = await getGmailToken(input.subjectId);
    const headers = [
        `From: ${process.env.WARDEN_GMAIL_FROM || "Warden CI"}`,
        `To: ${input.to}`,
        `Subject: ${input.subject}`,
        "MIME-Version: 1.0",
        "Content-Type: text/html; charset=UTF-8",
        `List-Unsubscribe: <${input.unsubscribeUrl}>`,
        `List-Unsubscribe-Post: List-Unsubscribe=One-Click`,
        "",
        input.html,
    ].join("\\r\\n");
    const encoded = Buffer.from(headers).toString("base64url");
    const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "Idempotency-Key": `warden-campaign/${input.campaignId}/${input.to}` },
        body: JSON.stringify({ raw: encoded }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok)
        throw new Error(`Gmail delivery failed (${response.status}): ${body?.error?.message || "provider rejected message"}`);
    return body;
}
async function sendApprovedEmail(input) {
    const token = await getResendToken();
    const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "Idempotency-Key": `warden-approval/${input.approvalId}` },
        body: JSON.stringify({ from: process.env.WARDEN_SUPPORT_FROM || "Warden Support <onboarding@resend.dev>", to: input.to, subject: input.subject, text: input.text }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok)
        throw new Error(`Resend delivery failed (${response.status})`);
    return body;
}
