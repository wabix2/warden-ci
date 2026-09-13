"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GMAIL_SCOPE = void 0;
exports.sendGmailMessage = sendGmailMessage;
const { getToken } = require("@vercel/connect");
const CONNECTOR_UID = "google/warden-support-gmail";
const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.send";
exports.GMAIL_SCOPE = GMAIL_SCOPE;
function encodeBase64Url(value) {
    return Buffer.from(value, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function mimeMessage(input) {
    return [
        `From: ${input.from}`,
        `To: ${input.to}`,
        `Subject: ${input.subject.replace(/[\r\n]/g, " ")}`,
        "MIME-Version: 1.0",
        "Content-Type: text/html; charset=UTF-8",
        "",
        input.html,
    ].join("\r\n");
}
async function sendGmailMessage(user, input) {
    const { token } = await getToken(CONNECTOR_UID, {
        subject: { type: "user", id: user.id, issuer: user.issuer },
        scopes: [GMAIL_SCOPE],
    });
    const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ raw: encodeBase64Url(mimeMessage(input)) }),
    });
    if (!response.ok)
        throw new Error(`Gmail send failed (${response.status})`);
}
