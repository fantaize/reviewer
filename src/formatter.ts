import type { VerifiedFinding, AgentResult, Severity } from "./agents/types.js";
import type { ReviewComment } from "./github.js";
import { buildDiffMap, isLineInDiff, findClosestDiffLine } from "./diff.js";

const SEVERITY_LABEL: Record<Severity, string> = {
  critical: "\uD83D\uDD34 Bug",
  warning: "\uD83D\uDD34 Warning",
  nit: "\uD83D\uDFE1 Nit",
  "pre-existing": "\uD83D\uDFE3 Pre-existing",
};

/**
 * Format a single finding as a GitHub review comment body.
 * Uses the structured section format: "What the bug is", "Concrete proof", "Impact and fix".
 * The description field already contains these sections from the agent prompts.
 */
function formatFindingComment(finding: VerifiedFinding): string {
  const lines: string[] = [];

  // The description contains the full structured comment with ### headings
  lines.push(finding.description);

  // Collapsible extended reasoning
  lines.push("");
  lines.push("<details>");
  lines.push(`<summary>Extended reasoning\u2026</summary>`);
  lines.push("");
  lines.push(finding.reasoning);
  if (finding.verifierReasoning) {
    lines.push("");
    lines.push(`**Verification:** ${finding.verifierReasoning}`);
  }
  lines.push("");
  lines.push(
    `*${SEVERITY_LABEL[finding.severity]} \u00B7 Confidence: ${finding.confidence}/100*`
  );
  lines.push("");
  lines.push("</details>");

  return lines.join("\n");
}

/**
 * Build GitHub review comments from verified findings.
 * Findings that don't map to diff lines are returned as overflow.
 */
export function buildReviewComments(
  findings: VerifiedFinding[],
  rawDiff: string
): { inlineComments: ReviewComment[]; overflowFindings: VerifiedFinding[] } {
  const diffMap = buildDiffMap(rawDiff);
  const inlineComments: ReviewComment[] = [];
  const overflowFindings: VerifiedFinding[] = [];

  for (const finding of findings) {
    const diffFile = diffMap.get(finding.file);

    if (!diffFile) {
      overflowFindings.push(finding);
      continue;
    }

    // Try exact line, then nearby lines
    let targetLine: number | undefined;
    if (isLineInDiff(diffFile, finding.startLine)) {
      targetLine = finding.startLine;
    } else {
      targetLine = findClosestDiffLine(diffFile, finding.startLine);
    }

    if (targetLine === undefined) {
      overflowFindings.push(finding);
      continue;
    }

    const comment: ReviewComment = {
      path: finding.file,
      line: finding.endLine !== finding.startLine ? finding.endLine : targetLine,
      body: formatFindingComment(finding),
    };

    if (finding.endLine > finding.startLine) {
      const startInDiff = findClosestDiffLine(diffFile, finding.startLine);
      if (startInDiff && startInDiff < comment.line) {
        comment.startLine = startInDiff;
      }
    }

    inlineComments.push(comment);
  }

  return { inlineComments, overflowFindings };
}

/**
 * Format the summary comment posted on the PR.
 */
export function formatSummaryComment(
  findings: VerifiedFinding[],
  overflowFindings: VerifiedFinding[],
  agentResults: AgentResult[],
  totalDuration: number
): string {
  const lines: string[] = [];

  if (findings.length === 0) {
    lines.push("**Code Review**");
    lines.push("");
    lines.push(
      `Reviewed ${agentResults.reduce((s, r) => s + r.findings.length, 0) || "all"} areas in ${formatDuration(totalDuration)}. No issues found \u2014 the changes look good.`
    );
    return lines.join("\n");
  }

  // Count by severity
  const counts: Record<Severity, number> = {
    critical: 0,
    warning: 0,
    nit: 0,
    "pre-existing": 0,
  };
  for (const f of findings) {
    counts[f.severity]++;
  }

  lines.push("**Code Review Summary**");
  lines.push("");

  // Concise severity breakdown with official markers
  const parts: string[] = [];
  if (counts.critical > 0) parts.push(`\uD83D\uDD34 ${counts.critical} critical`);
  if (counts.warning > 0) parts.push(`\uD83D\uDD34 ${counts.warning} warning${counts.warning !== 1 ? "s" : ""}`);
  if (counts.nit > 0) parts.push(`\uD83D\uDFE1 ${counts.nit} nit${counts.nit !== 1 ? "s" : ""}`);
  if (counts["pre-existing"] > 0) parts.push(`\uD83D\uDFE3 ${counts["pre-existing"]} pre-existing`);

  lines.push(
    `Found **${findings.length} issue${findings.length !== 1 ? "s" : ""}** (${parts.join(", ")}) in ${formatDuration(totalDuration)}.`
  );

  // Overflow findings (not in diff)
  if (overflowFindings.length > 0) {
    lines.push("");
    lines.push(
      "The following issues reference code outside the changed lines:"
    );
    lines.push("");
    for (const f of overflowFindings) {
      lines.push(
        `- **${f.file}:${f.startLine}** \u2014 ${f.title} *(${SEVERITY_LABEL[f.severity]})*`
      );
    }
  }

  // Agent stats in details
  lines.push("");
  lines.push("<details>");
  lines.push("<summary>Review details</summary>");
  lines.push("");
  for (const result of agentResults) {
    const status = result.error ? "\u2717" : "\u2713";
    lines.push(
      `- ${status} **${result.agentName}**: ${result.findings.length} findings in ${formatDuration(result.duration)}`
    );
  }
  lines.push("");
  lines.push("</details>");

  return lines.join("\n");
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}
