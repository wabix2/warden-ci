"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyDependencyRemediation = applyDependencyRemediation;
exports.manifestDiffIsScoped = manifestDiffIsScoped;
const semver_1 = __importDefault(require("semver"));
function assertTarget(targetVersion, vulnerableRange) {
    const cleanTarget = semver_1.default.valid(semver_1.default.coerce(targetVersion));
    if (!cleanTarget || !semver_1.default.validRange(vulnerableRange) || semver_1.default.satisfies(cleanTarget, vulnerableRange)) {
        throw new Error("Target version is invalid or remains vulnerable");
    }
}
function updateNpm(input) {
    if (input.manifestPath !== "package.json")
        throw new Error("Unsupported npm manifest");
    const packageJson = JSON.parse(input.manifestContent);
    const sections = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];
    const matches = sections.filter((section) => typeof packageJson[section]?.[input.packageName] === "string");
    if (matches.length !== 1)
        throw new Error(matches.length === 0 ? "Dependency is not present" : "Dependency entry is ambiguous");
    assertTarget(input.targetVersion, input.vulnerableRange);
    const section = matches[0];
    const previous = packageJson[section][input.packageName];
    const prefix = /^[~^<>=*\s|]/.test(previous) ? previous.match(/^[~^<>=*\s|]+/)?.[0] || "" : "";
    packageJson[section][input.packageName] = `${prefix}${semver_1.default.clean(input.targetVersion)}`;
    return { manifestContent: `${JSON.stringify(packageJson, null, 2)}\n`, manifestPath: input.manifestPath, packageName: input.packageName, from: previous, to: packageJson[section][input.packageName], changedSection: section };
}
function updatePython(input) {
    if (input.manifestPath !== "requirements.txt")
        throw new Error("Unsupported Python manifest");
    assertTarget(input.targetVersion, input.vulnerableRange);
    const lines = input.manifestContent.split(/(\r?\n)/);
    let matches = 0;
    let previous = "";
    const output = lines.map((line) => {
        if (/^\s*#/.test(line) || !line.includes(input.packageName))
            return line;
        const match = line.match(new RegExp(`^(\\s*${input.packageName.replace(/[.*+?^${}()|[\\]\\]/g, "\\\\$&")})(==|>=|~=|>|<)([^\\s;]+)(.*)$`, "i"));
        if (!match)
            return line;
        matches += 1;
        previous = `${match[2]}${match[3]}`;
        return `${match[1]}==${semver_1.default.clean(input.targetVersion)}${match[4]}`;
    });
    if (matches !== 1)
        throw new Error(matches === 0 ? "Dependency is not present or syntax is unsupported" : "Dependency entry is ambiguous");
    return { manifestContent: output.join(""), manifestPath: input.manifestPath, packageName: input.packageName, from: previous, to: `==${semver_1.default.clean(input.targetVersion)}`, changedSection: "requirements" };
}
function applyDependencyRemediation(input) {
    if (!input.packageName.trim() || !input.manifestContent)
        throw new Error("Invalid remediation input");
    return input.ecosystem === "npm" ? updateNpm(input) : updatePython(input);
}
function manifestDiffIsScoped(before, after, packageName) {
    const beforeLines = before.split(/\r?\n/);
    const afterLines = after.split(/\r?\n/);
    if (beforeLines.length !== afterLines.length && !before.endsWith("\n"))
        return false;
    const differences = afterLines.filter((line, index) => line !== beforeLines[index]);
    return differences.length === 1 && differences[0].toLowerCase().includes(packageName.toLowerCase());
}
