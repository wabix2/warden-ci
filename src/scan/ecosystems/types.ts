import { AddedLine } from "../diff";

export interface PackageMetadata {
  existsOnRegistry: boolean;
  /** Days since the package's earliest known release. Undefined if unknown or lookup failed. */
  publishedDaysAgo?: number;
}

export interface Ecosystem {
  /** Machine-readable id, used in telemetry records and finding messages. */
  id: string;
  /** Human-readable label for finding messages. */
  label: string;
  /** File extensions this ecosystem's import syntax applies to. */
  extensions: string[];
  /** Curated list of high-traffic package names, used for typosquat distance comparisons. */
  popularPackages: string[];
  /** Extracts imported package names -> the added-diff line numbers they appear on. */
  extractPackages(addedLines: AddedLine[]): Map<string, number[]>;
  /** Looks up whether a package exists and (best-effort) how long it's been published. */
  fetchMetadata(packageName: string): Promise<PackageMetadata>;
}
