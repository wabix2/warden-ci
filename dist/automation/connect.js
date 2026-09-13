"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getGmailToken = getGmailToken;
exports.getResendToken = getResendToken;
exports.sendApprovedEmail = sendApprovedEmail;
// Loaded dynamically because this project compiles CommonJS with legacy module resolution.
const { getToken } = require("@vercel/connect");
const GMAIL_CONNECTOR = "google/warden-support-gmail";
const RESEND_CONNECTOR = "api.resend.com/warden-support-email";
async function getGmailToken(subjectId) {
    const result = await getToken(GMAIL_CONNECTOR, { subject: { type: "user", id: subjectId } });
    return result.token;
}
async function getResendToken() {
    const result = await getToken(RESEND_CONNECTOR, { subject: { type: "app" } });
    return result.token;
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
