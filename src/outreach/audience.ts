export type AudienceRecipient = { email: string; name?: string; company?: string; consent: boolean };

const emailPattern = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function parseOptInAudience(input: string): AudienceRecipient[] {
  const recipients = new Map<string, AudienceRecipient>();
  for (const row of input.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)) {
    const columns = row.split(",").map((value) => value.trim().replace(/^"|"$/g, ""));
    if (columns[0].toLowerCase() === "email") continue;
    const email = columns[0].toLowerCase();
    if (!emailPattern.test(email)) throw new Error(`Invalid recipient: ${columns[0]}`);
    const consent = columns[3]?.toLowerCase() === "true" || columns[3]?.toLowerCase() === "yes";
    if (!consent) throw new Error(`Consent is required for ${email}`);
    recipients.set(email, { email, name: columns[1] || undefined, company: columns[2] || undefined, consent });
  }
  return [...recipients.values()];
}

export function buildSafeDraft(input: { name?: string; company?: string; product?: string; context?: string }): { subject: string; html: string } {
  const name = input.name?.replace(/[<>]/g, "") || "there";
  const company = input.company?.replace(/[<>]/g, "") || "your team";
  const product = input.product?.replace(/[<>]/g, "") || "Warden CI";
  const context = input.context?.replace(/[<>]/g, "").slice(0, 500) || "safer pull-request security";
  return { subject: `${product} for ${company}`, html: `<p>Hi ${name},</p><p>I thought ${product} might help ${company} with ${context}.</p><p>If this is not relevant, you can ignore this message. To unsubscribe, reply with “unsubscribe”.</p><p>Best,<br>Warden</p>` };
}
