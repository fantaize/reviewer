import { query } from "@anthropic-ai/claude-agent-sdk";
import type { PRContext, VerifiedFinding } from "./types.js";
import { getClaudePath } from "./utils.js";

export interface ReviewSummary {
  overview: string;
  securityRisks: string;
  levelOfScrutiny: string;
  otherFactors: string;
}

/**
 * Generate a structured PR-level summary with 4 sections:
 * Overview, Security risks, Level of scrutiny, Other factors.
 * Matches the official Claude Code Review format.
 */
export async function generateReviewSummary(
  context: PRContext,
  findings: VerifiedFinding[]
): Promise<ReviewSummary> {
  const fileList = context.changedFiles
    .map((f) => `${f.filename} (+${f.additions}/-${f.deletions})`)
    .join("\n");

  const findingsSummary = findings.length === 0
    ? "No issues were found."
    : findings
        .map((f, i) => `${i + 1}. [${f.severity}] ${f.file}:${f.startLine} — ${f.title}`)
        .join("\n");

  const prompt = `You are summarizing a code review for a pull request. Generate exactly 4 sections.

## PR Info
- **Title:** ${context.title}
- **Description:** ${context.body || "(none)"}

## Changed Files
${fileList}

## Findings (${findings.length} total)
${findingsSummary}

## Instructions

Write exactly 4 sections. Each must be a short paragraph (2-4 sentences). Be direct and specific.

**Overview:** What this PR does — scope, files changed, nature of the changes. Be factual.

**Security risks:** Assess security implications of the changes. If none, say "None." and briefly explain why (e.g. "All changes are documentation-only" or "No user input handling modified").

**Level of scrutiny:** How much scrutiny is appropriate for these changes and why. "Low" for docs/tests/config, "Medium" for most code changes, "High" for auth/payments/data handling.

**Other factors:** Any additional observations worth noting — patterns, style consistency, things that aren't bugs but are worth mentioning. If the findings already cover everything, say so.

Respond with ONLY the 4 sections in this exact format (no extra text):

**Overview**

<text>

**Security risks**

<text>

**Level of scrutiny**

<text>

**Other factors**

<text>`;

  try {
    const agentEnv: Record<string, string | undefined> = {
      ...process.env,
      CLAUDECODE: "",
    };
    if (context.modelConfig.apiKey) {
      agentEnv.ANTHROPIC_API_KEY = context.modelConfig.apiKey;
    }

    let fullText = "";
    const result = query({
      prompt,
      options: {
        model: context.modelConfig.model,
        maxTurns: 1,
        permissionMode: "dontAsk",
        allowedTools: [],
        env: agentEnv,
        pathToClaudeCodeExecutable: getClaudePath(),
        stderr: () => {},
        effort: "low",
      },
    });

    for await (const message of result) {
      if (message.type === "result" && message.subtype === "success" && message.result) {
        fullText = message.result;
      }
    }

    return parseSummary(fullText);
  } catch (err) {
    console.warn("[summarizer] Failed to generate summary:", err);
    return fallbackSummary(context, findings);
  }
}

function parseSummary(text: string): ReviewSummary {
  const sections: Record<string, string> = {};
  const sectionNames = ["Overview", "Security risks", "Level of scrutiny", "Other factors"];

  for (let i = 0; i < sectionNames.length; i++) {
    const name = sectionNames[i];
    const pattern = new RegExp(`\\*\\*${name}\\*\\*\\s*\\n\\n?`, "i");
    const match = text.match(pattern);
    if (!match || match.index === undefined) continue;

    const start = match.index + match[0].length;
    // Find the next section or end of text
    let end = text.length;
    for (let j = i + 1; j < sectionNames.length; j++) {
      const nextPattern = new RegExp(`\\*\\*${sectionNames[j]}\\*\\*`, "i");
      const nextMatch = text.slice(start).match(nextPattern);
      if (nextMatch && nextMatch.index !== undefined) {
        end = start + nextMatch.index;
        break;
      }
    }

    sections[name] = text.slice(start, end).trim();
  }

  return {
    overview: sections["Overview"] || "",
    securityRisks: sections["Security risks"] || "Not assessed.",
    levelOfScrutiny: sections["Level of scrutiny"] || "Standard.",
    otherFactors: sections["Other factors"] || "None.",
  };
}

function fallbackSummary(context: PRContext, findings: VerifiedFinding[]): ReviewSummary {
  const fileCount = context.changedFiles.length;
  const additions = context.changedFiles.reduce((s, f) => s + f.additions, 0);
  const deletions = context.changedFiles.reduce((s, f) => s + f.deletions, 0);
  const extensions = [...new Set(context.changedFiles.map(f => f.filename.split(".").pop()))];

  return {
    overview: `This PR changes ${fileCount} file${fileCount !== 1 ? "s" : ""} (${additions} additions, ${deletions} deletions) across ${extensions.join(", ")} files.`,
    securityRisks: findings.some(f => f.category === "security")
      ? `${findings.filter(f => f.category === "security").length} security issue(s) identified.`
      : "No security issues identified.",
    levelOfScrutiny: findings.length > 0
      ? "Standard scrutiny applied."
      : "Low scrutiny is appropriate for these changes.",
    otherFactors: findings.length > 0
      ? `${findings.length} issue(s) found and detailed in inline comments.`
      : "No additional observations.",
  };
}
