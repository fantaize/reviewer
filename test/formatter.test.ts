import { describe, it, expect } from "vitest";
import { buildReviewComments, formatSummaryComment } from "../src/formatter.js";
import type { VerifiedFinding, AgentResult } from "../src/agents/types.js";

function makeFinding(overrides: Partial<VerifiedFinding> = {}): VerifiedFinding {
  return {
    id: "test-1",
    file: "src/app.ts",
    startLine: 13,
    endLine: 13,
    severity: "warning",
    category: "bug",
    title: "Test finding",
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

  it("includes collapsible reasoning in comment body", () => {
    const findings = [makeFinding()];
    const { inlineComments } = buildReviewComments(findings, SAMPLE_DIFF);
    expect(inlineComments[0].body).toContain("<details>");
    expect(inlineComments[0].body).toContain("Extended reasoning");
    expect(inlineComments[0].body).toContain("Test reasoning");
    expect(inlineComments[0].body).toContain("Verification:");
  });
});

describe("formatSummaryComment", () => {
  it("shows 'no issues' message when no findings", () => {
    const agentResults: AgentResult[] = [
      { agentName: "bug-finder", findings: [], duration: 5000 },
    ];
    const summary = formatSummaryComment([], [], agentResults, 10000);
    expect(summary).toContain("No issues found");
    expect(summary).toContain("look good");
  });

  it("shows severity breakdown with emoji markers", () => {
    const findings = [
      makeFinding({ severity: "critical" }),
      makeFinding({ id: "t2", severity: "nit" }),
    ];
    const agentResults: AgentResult[] = [
      { agentName: "bug-finder", findings: [], duration: 5000 },
    ];
    const summary = formatSummaryComment(findings, [], agentResults, 10000);
    expect(summary).toContain("2 issue");
    // Check for emoji markers
    expect(summary).toContain("\uD83D\uDD34"); // red circle for critical
    expect(summary).toContain("\uD83D\uDFE1"); // yellow circle for nit
  });

  it("includes overflow findings in summary", () => {
    const overflow = [makeFinding({ file: "src/other.ts", title: "Overflow bug" })];
    const agentResults: AgentResult[] = [
      { agentName: "bug-finder", findings: [], duration: 5000 },
    ];
    const summary = formatSummaryComment([...overflow], overflow, agentResults, 10000);
    expect(summary).toContain("outside the changed lines");
    expect(summary).toContain("Overflow bug");
  });

  it("includes agent stats in collapsible details", () => {
    const agentResults: AgentResult[] = [
      { agentName: "bug-finder", findings: [], duration: 3000 },
      { agentName: "security-auditor", findings: [], duration: 5000 },
    ];
    const findings = [makeFinding()];
    const summary = formatSummaryComment(findings, [], agentResults, 10000);
    expect(summary).toContain("bug-finder");
    expect(summary).toContain("security-auditor");
    expect(summary).toContain("<details>");
  });
});
