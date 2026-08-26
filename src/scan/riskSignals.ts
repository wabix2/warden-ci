import { Ecosystem } from "./ecosystems/types";
import { levenshtein } from "./levenshtein";

export type Verdict = "hallucinated" | "typosquat-suspect";

export interface PackageVerdict {
  packageName: string;
  verdict: Verdict;
  /** Set only for typosquat-suspect: the popular package this name is suspiciously close to. */
  impersonating?: string;
  publishedDaysAgo?: number;
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

  return null; // exists, and nothing suspicious about it
}
