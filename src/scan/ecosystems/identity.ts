import { Ecosystem } from "./types";

export interface PackageIdentity {
  ecosystem: string;
  registry: string;
  name: string;
  normalizedName: string;
  version?: string;
  specifier?: string;
  importName?: string;
  namespace?: string;
  sourceReference?: string;
}

export function packageIdentity(ecosystem: Ecosystem, rawName: string): PackageIdentity {
  const name = rawName.trim();
  const normalizedName = ecosystem.id === "npm" || ecosystem.id === "pypi"
    ? name.toLowerCase().replace(/[-_.]+/g, "-")
    : name;
  const namespace = ecosystem.id === "npm" && normalizedName.startsWith("@") ? normalizedName.split("/")[0] : undefined;
  return { ecosystem: ecosystem.id, registry: ecosystem.label, name, normalizedName, namespace, importName: name };
}
