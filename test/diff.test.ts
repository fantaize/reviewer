import { describe, it, expect } from "vitest";
import {
  parseDiff,
  buildDiffMap,
  isLineInDiff,
  findClosestDiffLine,
  getDiffLineNumbers,
} from "../src/diff.js";

const SAMPLE_DIFF = `diff --git a/src/app.ts b/src/app.ts
index 1234567..abcdefg 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -10,6 +10,8 @@ import express from "express";
 const app = express();

 app.get("/", (req, res) => {
+  console.log("hello");
+  console.log("world");
   res.send("ok");
 });

@@ -30,3 +32,5 @@ app.listen(3000);
 function helper() {
   return true;
 }
+
+export default app;
`;

describe("parseDiff", () => {
  it("parses a unified diff into file objects", () => {
    const files = parseDiff(SAMPLE_DIFF);
    expect(files).toHaveLength(1);
    expect(files[0].to).toBe("src/app.ts");
    expect(files[0].chunks.length).toBeGreaterThanOrEqual(1);
  });
});

describe("buildDiffMap", () => {
  it("maps filenames to parsed diff data", () => {
    const map = buildDiffMap(SAMPLE_DIFF);
    expect(map.has("src/app.ts")).toBe(true);
    expect(map.size).toBe(1);
  });

  it("handles empty diff", () => {
    const map = buildDiffMap("");
    expect(map.size).toBe(0);
  });
});

describe("isLineInDiff", () => {
  it("returns true for added lines", () => {
    const map = buildDiffMap(SAMPLE_DIFF);
    const file = map.get("src/app.ts")!;
    // Lines 13 and 14 are the added lines in the first hunk
    expect(isLineInDiff(file, 13)).toBe(true);
    expect(isLineInDiff(file, 14)).toBe(true);
  });

  it("returns true for context (normal) lines", () => {
    const map = buildDiffMap(SAMPLE_DIFF);
    const file = map.get("src/app.ts")!;
    // Line 12 is context: app.get("/", ...
    expect(isLineInDiff(file, 12)).toBe(true);
  });

  it("returns false for lines outside diff hunks", () => {
    const map = buildDiffMap(SAMPLE_DIFF);
    const file = map.get("src/app.ts")!;
    expect(isLineInDiff(file, 1)).toBe(false);
    expect(isLineInDiff(file, 100)).toBe(false);
  });
});

describe("getDiffLineNumbers", () => {
  it("returns all new-side line numbers", () => {
    const map = buildDiffMap(SAMPLE_DIFF);
    const file = map.get("src/app.ts")!;
    const lines = getDiffLineNumbers(file);
    // Should include added lines and context lines
    expect(lines.has(13)).toBe(true);
    expect(lines.has(14)).toBe(true);
    expect(lines.size).toBeGreaterThan(2);
  });
});

describe("findClosestDiffLine", () => {
  it("returns exact match when line is in diff", () => {
    const map = buildDiffMap(SAMPLE_DIFF);
    const file = map.get("src/app.ts")!;
    expect(findClosestDiffLine(file, 13)).toBe(13);
  });

  it("returns nearby line within maxDistance", () => {
    const map = buildDiffMap(SAMPLE_DIFF);
    const file = map.get("src/app.ts")!;
    // Line 9 is not in diff but line 10 is (context)
    const closest = findClosestDiffLine(file, 9, 3);
    expect(closest).toBeDefined();
  });

  it("returns undefined for distant lines", () => {
    const map = buildDiffMap(SAMPLE_DIFF);
    const file = map.get("src/app.ts")!;
    expect(findClosestDiffLine(file, 1, 3)).toBeUndefined();
  });
});
