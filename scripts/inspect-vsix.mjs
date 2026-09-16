import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const root = new URL("../ide-extension/", import.meta.url);
const packageJson = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
const manifest = packageJson.contributes ?? {};
const vsix = execFileSync("npm", ["run", "package", "--", "--out", "phase3-warden.vsix"], { cwd: root, encoding: "utf8" });
const result = {
  packageName: packageJson.name,
  version: packageJson.version,
  activationEvents: packageJson.activationEvents ?? [],
  commands: manifest.commands ?? [],
  configuration: manifest.configuration ?? {},
  packageOutput: vsix.trim().split("\n").slice(-5),
  externalInstall: "UNVERIFIED: no clean VS Code executable was available in this environment",
};
console.log(JSON.stringify(result, null, 2));
