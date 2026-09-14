const { getToken } = require("@vercel/connect") as {
  getToken: (uid: string, options: { subject: { type: "user"; id: string; issuer?: string }; scopes: string[] }) => Promise<{ token: string }>;
};

const CONNECTOR_UID = "google/warden-support-gmail";
const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.send";

type GmailUser = { id: string; issuer: string };

function encodeBase64Url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function mimeMessage(input: { from: string; to: string; subject: string; html: string }): string {
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

export async function sendGmailMessage(user: GmailUser, input: { from: string; to: string; subject: string; html: string }): Promise<void> {
  const { token } = await getToken(CONNECTOR_UID, {
    subject: { type: "user", id: user.id, issuer: user.issuer },
    scopes: [GMAIL_SCOPE],
  });
  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw: encodeBase64Url(mimeMessage(input)) }),
  });
  if (!response.ok) throw new Error(`Gmail send failed (${response.status})`);
}

export { GMAIL_SCOPE };
