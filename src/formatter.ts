import type { VerifiedFinding, Severity } from "./agents/types.js";
import type { ReviewComment } from "./github.js";
import { buildDiffMap, isLineInDiff, findClosestDiffLine } from "./diff.js";

const SEVERITY_LABEL: Record<Severity, string> = {
  normal: "issue",
  nit: "nit",
  "pre-existing": "pre-existing",
};

/**
 * Format a single finding as a GitHub review comment body.
 * Uses the structured section format: "What the bug is", "Concrete proof", "Impact and fix".
 * The description field already contains these sections from the agent prompts.
 */
function formatFindingComment(finding: VerifiedFinding): string {
  const lines: string[] = [];

  // Visible prose summary above the fold
  lines.push(finding.summary || finding.title);

  // Collapsible extended reasoning with full structured analysis
  lines.push("");
  lines.push("<details>");
  lines.push(`<summary>Extended reasoning\u2026</summary>`);
  lines.push("");
  lines.push(finding.description);
  lines.push("");
  lines.push(finding.reasoning);
  if (finding.verifierReasoning) {
    lines.push("");
    lines.push(`**Verification:** ${finding.verifierReasoning}`);
  }
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
 * Build the review body — a global message listing all findings.
 * This stays visible even when inline threads are resolved.
 */
export function buildReviewBody(
  findings: VerifiedFinding[],
  overflowFindings: VerifiedFinding[],
  totalDuration: number
): string {
  if (findings.length === 0) {
    return `No issues found in ${formatDuration(totalDuration)} \u2014 the changes look good.`;
  }

  const lines: string[] = [];

  lines.push(`Found **${findings.length} issue${findings.length !== 1 ? "s" : ""}** in ${formatDuration(totalDuration)}.`);
  lines.push("");

  for (let i = 0; i < findings.length; i++) {
    const f = findings[i];
    const label = SEVERITY_LABEL[f.severity];
    lines.push(`${i + 1}. **${f.file}:${f.startLine}** \u2014 ${f.summary || f.title} *(${label})*`);
  }

  if (overflowFindings.length > 0) {
    lines.push("");
    lines.push("*Issues outside the changed lines are listed above but could not be attached as inline comments.*");
  }

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
