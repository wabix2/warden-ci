import fs from "node:fs";
import { ECOSYSTEMS } from "../dist/scan/index.js";

const readme = fs.readFileSync("README.md", "utf8");
const benchmark = fs.readFileSync("BENCHMARK.md", "utf8");
const lines = ECOSYSTEMS.map((ecosystem) => `- ${ecosystem.id}: ${ecosystem.extensions.join(", ")} (${ecosystem.popularPackages.length} popular references; ${ecosystem.popularPackages.length >= 50 ? "refresh-backed" : "no live ranking source configured"})`);
const block = ["<!-- GENERATED_ECOSYSTEM_STATUS -->", ...lines, "<!-- END_GENERATED_ECOSYSTEM_STATUS -->"].join("\n");
for (const [name, document] of [["README.md", readme], ["BENCHMARK.md", benchmark]]) {
  if (!document.includes("<!-- GENERATED_ECOSYSTEM_STATUS -->") || !document.includes("<!-- END_GENERATED_ECOSYSTEM_STATUS -->")) throw new Error(`${name} is missing generated ecosystem status markers`);
  if (document.slice(document.indexOf("<!-- GENERATED_ECOSYSTEM_STATUS -->"), document.indexOf("<!-- END_GENERATED_ECOSYSTEM_STATUS -->") + "<!-- END_GENERATED_ECOSYSTEM_STATUS -->".length) !== block) throw new Error(`${name} ecosystem status diverges from registered code`);
}
if (new Set(ECOSYSTEMS.flatMap((ecosystem) => ecosystem.extensions)).size !== ECOSYSTEMS.flatMap((ecosystem) => ecosystem.extensions).length) throw new Error("duplicate ecosystem extension registered");
console.log(block);
