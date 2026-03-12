import { describe, it, expect } from "vitest";
import { buildReviewComments, buildReviewBody } from "../src/formatter.js";
import type { VerifiedFinding } from "../src/agents/types.js";
import type { ReviewSummary } from "../src/agents/summarizer.js";

const SAMPLE_SUMMARY: ReviewSummary = {
  overview: "This PR adds a new API endpoint for user management.",
  securityRisks: "None. No user input handling modified.",
  levelOfScrutiny: "Low scrutiny is appropriate for these changes.",
  otherFactors: "No additional observations.",
};

function makeFinding(overrides: Partial<VerifiedFinding> = {}): VerifiedFinding {
  return {
    id: "test-1",
    file: "src/app.ts",
    startLine: 13,
    endLine: 13,
    severity: "normal",
    category: "bug",
    title: "Test finding",
    summary: "This function has a bug that causes incorrect behavior. Fix it by adding a null check.",
    description: "### What the bug is\n\nTest description",
    reasoning: "Test reasoning",
    confidence: 90,
    verifierReasoning: "Verified as genuine",
    agentSource: "bug-finder",
    ...overrides,
  };
}

const SAMPLE_DIFF = `diff --git a/src/app.ts b/src/app.ts
--- a/src/app.ts
+++ b/src/app.ts
@@ -10,6 +10,8 @@ import express from "express";
 const app = express();

 app.get("/", (req, res) => {
+  console.log("hello");
+  console.log("world");
   res.send("ok");
 });
`;

describe("buildReviewComments", () => {
  it("maps findings to inline comments when in diff", () => {
    const findings = [makeFinding({ file: "src/app.ts", startLine: 13, endLine: 13 })];
    const { inlineComments, overflowFindings } = buildReviewComments(findings, SAMPLE_DIFF);
    expect(inlineComments).toHaveLength(1);
    expect(overflowFindings).toHaveLength(0);
    expect(inlineComments[0].path).toBe("src/app.ts");
    expect(inlineComments[0].line).toBe(13);
  });

  it("puts findings outside diff into overflow", () => {
    const findings = [makeFinding({ file: "src/other.ts", startLine: 5, endLine: 5 })];
    const { inlineComments, overflowFindings } = buildReviewComments(findings, SAMPLE_DIFF);
    expect(inlineComments).toHaveLength(0);
    expect(overflowFindings).toHaveLength(1);
  });

  it("shows severity emoji and prose summary above fold, structured content inside details", () => {
    const findings = [makeFinding()];
    const { inlineComments } = buildReviewComments(findings, SAMPLE_DIFF);
    const body = inlineComments[0].body;
    // Severity emoji prefix for normal issues (🔴)
    expect(body).toMatch(/^🔴/);
    // Prose summary is visible above the fold
    expect(body).toContain("This function has a bug");
    // Structured description is inside details
    expect(body).toContain("<details>");
    expect(body).toContain("Extended reasoning");
    expect(body).toContain("What the bug is");
    expect(body).toContain("Test reasoning");
    expect(body).toContain("Verification:");
    // No confidence score
    expect(body).not.toContain("confidence:");
  });

  it("shows 'Nit:' label for nit severity", () => {
    const findings = [makeFinding({ severity: "nit" })];
    const { inlineComments } = buildReviewComments(findings, SAMPLE_DIFF);
    const body = inlineComments[0].body;
    expect(body).toMatch(/🟡 Nit:/);
  });
});

describe("buildReviewBody", () => {
  it("shows LGTM message with structured sections when no findings", () => {
    const body = buildReviewBody([], [], 10000, SAMPLE_SUMMARY);
    expect(body).toContain("LGTM");
    expect(body).toContain("look good");
    expect(body).toContain("<details>");
    expect(body).toContain("Extended reasoning");
    expect(body).toContain("### Overview");
    expect(body).toContain("### Security risks");
    expect(body).toContain("### Level of scrutiny");
    expect(body).toContain("### Other factors");
    expect(body).toContain("new API endpoint");
  });

  it("lists findings with structured sections inside extended reasoning", () => {
    const findings = [
      makeFinding({ severity: "normal" }),
      makeFinding({ id: "t2", severity: "nit", file: "src/other.ts", startLine: 5, title: "Nit issue", summary: "Minor style issue." }),
    ];
    const body = buildReviewBody(findings, [], 10000, SAMPLE_SUMMARY);
    expect(body).toContain("2 issues");
    expect(body).toContain("<details>");
    expect(body).toContain("### Overview");
    expect(body).toContain("### Findings");
    expect(body).toContain("src/app.ts:13");
    expect(body).toContain("src/other.ts:5");
    expect(body).toContain("🔴");
    expect(body).toContain("🟡");
  });

  it("notes overflow findings", () => {
    const overflow = [makeFinding({ file: "src/other.ts", title: "Overflow bug" })];
    const body = buildReviewBody([...overflow], overflow, 10000, SAMPLE_SUMMARY);
    expect(body).toContain("outside the changed lines");
  });

  it("does not expose internal agent names", () => {
    const findings = [makeFinding()];
    const body = buildReviewBody(findings, [], 10000, SAMPLE_SUMMARY);
    expect(body).not.toContain("bug-finder");
    expect(body).not.toContain("security-auditor");
  });

  it("works without summary (fallback)", () => {
    const body = buildReviewBody([], [], 10000);
    expect(body).toContain("LGTM");
    expect(body).toContain("<details>");
    expect(body).not.toContain("### Overview");
  });
});
