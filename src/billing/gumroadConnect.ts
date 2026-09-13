// Loaded dynamically so the existing CommonJS TypeScript target can use the
// Connect SDK without changing the server module system.
const { getToken } = require("@vercel/connect") as { getToken: (uid: string, options: { subject: { type: "app" } }) => Promise<{ token: string }> };

const CONNECTOR_UID = "gumroad.com/warden-pro-billing";

export async function getGumroadApiToken(): Promise<string> {
  const result = await getToken(CONNECTOR_UID, { subject: { type: "app" } });
  return result.token;
}

export async function verifyGumroadSale(saleId: string): Promise<unknown> {
  const token = await getGumroadApiToken();
  const response = await fetch(`https://api.gumroad.com/v2/sales/${encodeURIComponent(saleId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(`Gumroad verification failed (${response.status})`);
  return response.json();
}
