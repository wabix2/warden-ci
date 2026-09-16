import { Ecosystem } from "./ecosystems/types";
import { levenshtein } from "./levenshtein";

export type Verdict = "hallucinated" | "typosquat-suspect" | "dependency-confusion-suspect" | "maintainer-takeover-suspect" | "known-malware";

export interface PackageVerdict {
  packageName: string;
  verdict: Verdict;
  /** Set only for typosquat-suspect: the popular package this name is suspiciously close to. */
  impersonating?: string;
  publishedDaysAgo?: number;
  latestVersion?: string;
  latestPublisher?: string;
}

// A package published within this window that also sits this close to a popular
// name is treated as a live typosquat/slopsquat risk, not just a coincidence.
// Both thresholds are deliberately conservative — tightened to keep false positives
// rare, at the cost of missing older or more distant squats. Loosening these is the
// first knob to turn once real usage data (see telemetry) shows the current
// thresholds are too strict or too loose in practice.
const FRESHNESS_WINDOW_DAYS = 45;
const MAX_EDIT_DISTANCE = 2;
const MIN_NAME_LENGTH_FOR_DISTANCE_CHECK = 4; // very short names make edit-distance-1 nearly meaningless
// A major version of 10+ is not suspicious by itself: legitimate libraries can
// evolve for years. Requiring <=3 observed releases and a release within 45 days
// makes this a narrow public-metadata proxy for a high-version shadow package.
const DEPENDENCY_CONFUSION_MAJOR = 10;
const DEPENDENCY_CONFUSION_MAX_RELEASES = 3;
const DEPENDENCY_CONFUSION_FRESHNESS_DAYS = 45;
// A publisher change is only actionable here when the package has a public
// install-base proxy (it is in the refreshed popular set) and the change is
// recent. This avoids treating ordinary historical ownership transfers as takeovers.
const TAKEOVER_FRESHNESS_DAYS = 45;

function closestPopularPackage(packageName: string, popular: string[]): { name: string; distance: number } | null {
  if (packageName.length < MIN_NAME_LENGTH_FOR_DISTANCE_CHECK) return null;
  if (popular.includes(packageName)) return null; // it IS the popular package, not impersonating one

  let best: { name: string; distance: number } | null = null;
  for (const candidate of popular) {
    if (candidate === packageName) continue;
    // Cheap length pre-filter avoids running full Levenshtein against names that
    // can't possibly be within MAX_EDIT_DISTANCE.
    if (Math.abs(candidate.length - packageName.length) > MAX_EDIT_DISTANCE) continue;
    const distance = levenshtein(packageName, candidate);
    if (distance <= MAX_EDIT_DISTANCE && (!best || distance < best.distance)) {
      best = { name: candidate, distance };
    }
  }
  return best;
}

export async function assessPackage(packageName: string, ecosystem: Ecosystem): Promise<PackageVerdict | null> {
  const metadata = await ecosystem.fetchMetadata(packageName);

  if (metadata.lookupStatus === "unavailable") {
    throw new Error(`Registry lookup unavailable for ${ecosystem.id}:${packageName}`);
  }

  if (!metadata.existsOnRegistry) {
    return { packageName, verdict: "hallucinated" };
  }

  const close = closestPopularPackage(packageName, ecosystem.popularPackages);
  if (
    close &&
    metadata.publishedDaysAgo !== undefined &&
    metadata.publishedDaysAgo <= FRESHNESS_WINDOW_DAYS
  ) {
    return {
      packageName,
      verdict: "typosquat-suspect",
      impersonating: close.name,
      publishedDaysAgo: metadata.publishedDaysAgo,
    };
  }

  const majorVersion = metadata.latestVersion?.match(/^(\d+)/)?.[1];
  const dependencyConfusionSuspect = majorVersion !== undefined
    && Number(majorVersion) >= DEPENDENCY_CONFUSION_MAJOR
    && metadata.releaseCount !== undefined
    && metadata.releaseCount <= DEPENDENCY_CONFUSION_MAX_RELEASES
    && metadata.latestReleaseDaysAgo !== undefined
    && metadata.latestReleaseDaysAgo <= DEPENDENCY_CONFUSION_FRESHNESS_DAYS;
  if (dependencyConfusionSuspect) {
    return { packageName, verdict: "dependency-confusion-suspect", latestVersion: metadata.latestVersion };
  }

  const maintainerTakeoverSuspect = ecosystem.id === "npm"
    && ecosystem.popularPackages.includes(packageName)
    && metadata.publisherChangedRecently === true
    && metadata.publisherHistory !== undefined
    && metadata.publisherHistory.length >= 2
    && metadata.latestReleaseDaysAgo !== undefined
    && metadata.latestReleaseDaysAgo <= TAKEOVER_FRESHNESS_DAYS;
  if (maintainerTakeoverSuspect) {
    return { packageName, verdict: "maintainer-takeover-suspect", latestPublisher: metadata.latestPublisher };
  }

  return null; // exists, and nothing suspicious about it
}
