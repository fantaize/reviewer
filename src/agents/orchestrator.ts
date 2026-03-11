import type {
  AgentResult,
  Finding,
  PRContext,
  VerifiedFinding,
} from "./types.js";
import { runBugFinder } from "./bug-finder.js";
import { runSecurityAuditor } from "./security.js";
import { runStyleChecker } from "./style.js";
import { runVerifier } from "./verifier.js";

export interface OrchestratorOptions {
  confidenceThreshold: number;
}

// File patterns to always skip
const SKIP_PATTERNS = [
  /\.lock$/,
  /package-lock\.json$/,
  /yarn\.lock$/,
  /pnpm-lock\.yaml$/,
  /\.min\.(js|css)$/,
  /\.map$/,
  /\.snap$/,
  /\.svg$/,
  /\.png$/,
  /\.jpg$/,
  /\.gif$/,
  /\.ico$/,
  /\.woff2?$/,
  /\.ttf$/,
  /\.eot$/,
  /\.pdf$/,
];

/**
 * Run the full multi-agent review pipeline:
 * 1. Filter files
 * 2. Parallel analysis agents
 * 3. Deduplicate
 * 4. Verify
 * 5. Filter by confidence
 * 6. Rank
 */
export async function orchestrate(
  context: PRContext,
  options: OrchestratorOptions
): Promise<{ findings: VerifiedFinding[]; agentResults: AgentResult[] }> {
  // Filter files
  const filteredContext = filterContext(context);

  if (filteredContext.changedFiles.length === 0) {
    return { findings: [], agentResults: [] };
  }

  // Determine which agents to run
  const hasRules = context.reviewConfig.rules.length > 0;
  const hasClaudeMd = context.reviewConfig.claudeMdFiles.length > 0;

  // Run style checker if there are rules OR CLAUDE.md files (CLAUDE.md violations are nit-level)
  const runStyle = hasRules || hasClaudeMd;

  console.log(
    `[orchestrator] Reviewing ${filteredContext.changedFiles.length} files with ${runStyle ? 3 : 2} agents` +
    (hasClaudeMd ? ` (${context.reviewConfig.claudeMdFiles.length} CLAUDE.md file(s))` : "")
  );

  // Phase 1: Parallel analysis
  const agentPromises: Promise<AgentResult>[] = [
    runBugFinder(filteredContext),
    runSecurityAuditor(filteredContext),
  ];

  if (runStyle) {
    agentPromises.push(runStyleChecker(filteredContext));
  }

  const settled = await Promise.allSettled(agentPromises);

  const agentResults: AgentResult[] = [];
  const allFindings: Finding[] = [];

  for (const result of settled) {
    if (result.status === "fulfilled") {
      agentResults.push(result.value);
      allFindings.push(...result.value.findings);
      console.log(
        `[orchestrator] ${result.value.agentName}: ${result.value.findings.length} findings in ${result.value.duration}ms${result.value.error ? ` (error: ${result.value.error})` : ""}`
      );
    } else {
      console.error("[orchestrator] Agent failed:", result.reason);
    }
  }

  if (allFindings.length === 0) {
    console.log("[orchestrator] No findings from any agent");
    return { findings: [], agentResults };
  }

  // Phase 2: Deduplicate
  const deduplicated = deduplicateFindings(allFindings);
  console.log(
    `[orchestrator] ${allFindings.length} findings → ${deduplicated.length} after dedup`
  );

  // Phase 3: Verify
  console.log(`[orchestrator] Verifying ${deduplicated.length} findings...`);
  const verified = await runVerifier(filteredContext, deduplicated);

  // Phase 4: Filter by confidence
  const filtered = verified.filter(
    (f) => f.confidence >= options.confidenceThreshold
  );
  console.log(
    `[orchestrator] ${verified.length} verified → ${filtered.length} above threshold (${options.confidenceThreshold})`
  );

  // Phase 5: Rank
  const ranked = rankFindings(filtered);

  return { findings: ranked, agentResults };
}

function filterContext(context: PRContext): PRContext {
  const ignorePatterns = context.reviewConfig.ignorePatterns;

  const filteredFiles = context.changedFiles.filter((file) => {
    // Skip binary/generated files
    if (SKIP_PATTERNS.some((pattern) => pattern.test(file.filename))) {
      return false;
    }

    // Skip files matching ignore patterns from REVIEW.md
    if (
      ignorePatterns.some((pattern) => {
        const regex = globToRegex(pattern);
        return regex.test(file.filename);
      })
    ) {
      return false;
    }

    // Skip deleted files (nothing to review)
    if (file.status === "removed") return false;

    return true;
  });

  // Rebuild diff with only the filtered files' patches
  const filteredDiff = filteredFiles
    .filter((f) => f.patch)
    .map((f) => `diff --git a/${f.filename} b/${f.filename}\n${f.patch}`)
    .join("\n");

  return {
    ...context,
    changedFiles: filteredFiles,
    diff: filteredDiff || context.diff,
  };
}

/**
 * Deduplicate findings that reference the same file and overlapping lines.
 */
function deduplicateFindings(findings: Finding[]): Finding[] {
  const deduplicated: Finding[] = [];

  for (const finding of findings) {
    const existing = deduplicated.find(
      (f) =>
        f.file === finding.file &&
        linesOverlap(f.startLine, f.endLine, finding.startLine, finding.endLine) &&
        titleSimilarity(f.title, finding.title) > 0.5
    );

    if (existing) {
      // Keep the one with higher severity
      const severityOrder = { critical: 0, warning: 1, nit: 2, "pre-existing": 3 };
      if (severityOrder[finding.severity] < severityOrder[existing.severity]) {
        Object.assign(existing, {
          severity: finding.severity,
          title: finding.title,
          description: finding.description,
          reasoning: `${existing.reasoning}\n\n---\nAlso found by ${finding.agentSource}:\n${finding.reasoning}`,
        });
      }
    } else {
      deduplicated.push({ ...finding });
    }
  }

  return deduplicated;
}

function linesOverlap(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number
): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

/**
 * Simple title similarity based on word overlap.
 */
function titleSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\s+/));
  const wordsB = new Set(b.toLowerCase().split(/\s+/));
  let overlap = 0;
  for (const word of wordsA) {
    if (wordsB.has(word)) overlap++;
  }
  const total = Math.max(wordsA.size, wordsB.size);
  return total === 0 ? 0 : overlap / total;
}

function rankFindings(findings: VerifiedFinding[]): VerifiedFinding[] {
  const severityOrder = { critical: 0, warning: 1, nit: 2, "pre-existing": 3 };

  return [...findings].sort((a, b) => {
    // By severity (critical first)
    const sevDiff = severityOrder[a.severity] - severityOrder[b.severity];
    if (sevDiff !== 0) return sevDiff;

    // By confidence (higher first)
    const confDiff = b.confidence - a.confidence;
    if (confDiff !== 0) return confDiff;

    // By file path (alphabetical)
    return a.file.localeCompare(b.file);
  });
}

/**
 * Convert a simple glob pattern to a regex.
 * Supports * and ** wildcards.
 */
function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "{{GLOBSTAR}}")
    .replace(/\*/g, "[^/]*")
    .replace(/\{\{GLOBSTAR\}\}/g, ".*");
  return new RegExp(`^${escaped}$`);
}
