import parseDiffLib from "parse-diff";

export type ParsedFile = parseDiffLib.File;
export type ParsedChunk = parseDiffLib.Chunk;
export type ParsedChange = parseDiffLib.Change;

export function parseDiff(rawDiff: string): ParsedFile[] {
  return parseDiffLib(rawDiff);
}

/**
 * Check if a line number falls within a diff hunk for a given file.
 * GitHub API requires review comments to reference lines in the diff.
 */
export function isLineInDiff(file: ParsedFile, line: number): boolean {
  for (const chunk of file.chunks) {
    for (const change of chunk.changes) {
      if (change.type === "add" || change.type === "normal") {
        const ln = change.type === "add" ? change.ln : change.ln2;
        if (ln === line) return true;
      }
    }
  }
  return false;
}

/**
 * Get all new-side line numbers present in the diff for a file.
 */
export function getDiffLineNumbers(file: ParsedFile): Set<number> {
  const lines = new Set<number>();
  for (const chunk of file.chunks) {
    for (const change of chunk.changes) {
      if (change.type === "add") {
        lines.add(change.ln);
      } else if (change.type === "normal") {
        lines.add(change.ln2);
      }
    }
  }
  return lines;
}

/**
 * Build a map from filename to parsed diff data.
 */
export function buildDiffMap(rawDiff: string): Map<string, ParsedFile> {
  const files = parseDiff(rawDiff);
  const map = new Map<string, ParsedFile>();
  for (const file of files) {
    const name = file.to ?? file.from ?? "";
    if (name && name !== "/dev/null") {
      map.set(name, file);
    }
  }
  return map;
}

/**
 * Find the closest line in the diff to a given target line.
 * Returns the diff line if within range, or undefined.
 */
export function findClosestDiffLine(
  file: ParsedFile,
  targetLine: number,
  maxDistance = 3
): number | undefined {
  const diffLines = getDiffLineNumbers(file);
  if (diffLines.has(targetLine)) return targetLine;

  for (let d = 1; d <= maxDistance; d++) {
    if (diffLines.has(targetLine + d)) return targetLine + d;
    if (diffLines.has(targetLine - d)) return targetLine - d;
  }
  return undefined;
}
