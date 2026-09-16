import { AddedLine } from "../diff";

<<<<<<< HEAD
export type MetadataLookupStatus = "ok" | "not_found" | "unavailable";

export interface PackageMetadata {
  existsOnRegistry: boolean;
  lookupStatus?: MetadataLookupStatus;
=======
export interface PackageMetadata {
  existsOnRegistry: boolean;
>>>>>>> origin/main
  /** Days since the package's earliest known release. Undefined if unknown or lookup failed. */
  publishedDaysAgo?: number;
  /** Latest published semantic version, when the registry exposes one. */
  latestVersion?: string;
  /** Number of non-yanked published versions observed in registry metadata. */
  releaseCount?: number;
  /** npm publisher identity history; unavailable for PyPI JSON metadata. */
  publisherHistory?: string[];
  /** Latest npm publisher, when present in the packument. */
  latestPublisher?: string;
  /** Latest npm publisher differs from the preceding observed publisher. */
  publisherChangedRecently?: boolean;
  /** Days since the latest release, when known. */
  latestReleaseDaysAgo?: number;
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
