// Loaded dynamically because this project compiles CommonJS with legacy module resolution.
const { getToken } = require("@vercel/connect") as { getToken: (uid: string, options: { subject: { type: "user" | "app"; id?: string } }) => Promise<{ token: string }> };

const GMAIL_CONNECTOR = "google/warden-support-gmail";
const RESEND_CONNECTOR = "api.resend.com/warden-support-email";

export async function getGmailToken(subjectId: string): Promise<string> {
  const result = await getToken(GMAIL_CONNECTOR, { subject: { type: "user", id: subjectId } });
  return result.token;
}

export async function getResendToken(): Promise<string> {
  const result = await getToken(RESEND_CONNECTOR, { subject: { type: "app" } });
  return result.token;
}

export async function sendGmailCampaignEmail(input: { subjectId: string; to: string; subject: string; html: string; campaignId: string; unsubscribeUrl: string }) {
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
  if (!response.ok) throw new Error(`Gmail delivery failed (${response.status}): ${body?.error?.message || "provider rejected message"}`);
  return body as { id?: string; threadId?: string };
}

export async function sendApprovedEmail(input: { to: string[]; subject: string; text: string; approvalId: string }) {
  const token = await getResendToken();
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "Idempotency-Key": `warden-approval/${input.approvalId}` },
    body: JSON.stringify({ from: process.env.WARDEN_SUPPORT_FROM || "Warden Support <onboarding@resend.dev>", to: input.to, subject: input.subject, text: input.text }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Resend delivery failed (${response.status})`);
  return body as { id?: string };
}
