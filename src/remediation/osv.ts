export type OsvAdvisory = {
  id: string;
  packageName: string;
  ecosystem: "npm" | "PyPI";
  affectedRange: string;
  fixedVersion?: string;
  severity?: string;
};

type OsvResponse = { vulns?: Array<{ id?: string; severity?: Array<{ score?: string }>; affected?: Array<{ package?: { name?: string; ecosystem?: string }; ranges?: Array<{ events?: Array<{ introduced?: string; fixed?: string }> }> }> }> };

export async function resolveOsvAdvisory(ecosystem: "npm" | "python", packageName: string, version: string, fetcher: typeof fetch = fetch): Promise<OsvAdvisory | null> {
  const queryEcosystem = ecosystem === "python" ? "PyPI" : "npm";
  const response = await fetcher("https://api.osv.dev/v1/query", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ package: { name: packageName, ecosystem: queryEcosystem }, version }) });
  if (!response.ok) throw new Error(`OSV lookup failed (${response.status})`);
  const body = await response.json() as OsvResponse;
  for (const vulnerability of body.vulns || []) {
    for (const affected of vulnerability.affected || []) {
      if (affected.package?.name !== packageName) continue;
      const events = affected.ranges?.flatMap((range) => range.events || []) || [];
      const fixedEvent = events.find((event) => event.fixed);
      const fixedVersion = fixedEvent?.fixed;
      const affectedRange = fixedVersion ? `<${fixedVersion}` : undefined;
      if (vulnerability.id && fixedVersion && affectedRange) return { id: vulnerability.id, packageName, ecosystem: queryEcosystem, affectedRange, fixedVersion, severity: vulnerability.severity?.[0]?.score };
    }
  }
  return null;
}
