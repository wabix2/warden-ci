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
  packageManager?: string;
  lockfileIdentity?: string;
  ambiguous?: boolean;
  ambiguityReason?: string;
}

export function packageIdentity(ecosystem: Ecosystem, rawName: string): PackageIdentity {
  const name = rawName.trim();
  const normalizedName = ecosystem.id === "npm"
    ? name.toLowerCase().replace(/\s+/g, "")
    : ecosystem.id === "pypi"
      ? name.toLowerCase().replace(/[-_.]+/g, "-")
      : name;
  const namespace = ecosystem.id === "npm" && normalizedName.startsWith("@") ? normalizedName.split("/")[0] : undefined;
  const packageManager = ecosystem.id === "npm" ? "npm" : ecosystem.id === "pypi" ? "pip" : ecosystem.id === "cargo" ? "cargo" : ecosystem.id === "go" ? "go" : ecosystem.id;
  const pythonAmbiguous = ecosystem.id === "pypi" && /[-_.]/.test(name);
  return {
    ecosystem: ecosystem.id,
    registry: ecosystem.label,
    name,
    normalizedName,
    namespace,
    importName: name,
    sourceReference: ecosystem.id === "go" ? name : undefined,
    packageManager,
    ambiguous: pythonAmbiguous,
    ambiguityReason: pythonAmbiguous ? "Python distribution name may not equal import name" : undefined,
  };
}
