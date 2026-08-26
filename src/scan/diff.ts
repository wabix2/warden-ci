/**
 * Warden CI — unified diff parsing.
 *
 * GitHub's "list PR files" API returns a `patch` field per file: a standard
 * unified diff hunk (no file headers, just the @@ hunks). We only care about
 * *added* lines — new code introduced by this PR — and the line number each
 * one lands on in the new version of the file, since that's what GitHub
 * Check Run annotations need to point at.
 *
 * Note: GitHub omits `patch` entirely for very large diffs (it truncates the
 * response rather than sending a patch over a certain size). Callers must
 * treat a missing patch as "nothing to scan in this file," not an error.
 */

export interface AddedLine {
  /** 1-indexed line number in the NEW version of the file. */
  line: number;
  /** The added line's content, without the leading "+". */
  content: string;
}

const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

export function parseAddedLines(patch: string | undefined | null): AddedLine[] {
  if (!patch) return [];

  const added: AddedLine[] = [];
  let newLine = 0;

  for (const rawLine of patch.split("\n")) {
    const hunkMatch = HUNK_HEADER.exec(rawLine);
    if (hunkMatch) {
      newLine = parseInt(hunkMatch[1], 10);
      continue;
    }

    if (rawLine.startsWith("+") && !rawLine.startsWith("+++")) {
      added.push({ line: newLine, content: rawLine.slice(1) });
      newLine += 1;
    } else if (rawLine.startsWith("-") && !rawLine.startsWith("---")) {
      // Removed line — doesn't exist in the new file, doesn't consume a new-line number.
      continue;
    } else if (!rawLine.startsWith("\\")) {
      // Context line (or blank) — exists in both versions, advances the new-file counter.
      // ("\ No newline at end of file" markers start with "\" and don't count.)
      newLine += 1;
    }
  }

  return added;
}
