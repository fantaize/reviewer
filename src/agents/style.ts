import type { AgentResult, PRContext } from "./types.js";
import { runAgent } from "./runner.js";

function buildSystemPrompt(context: PRContext): string {
  const { rules, claudeMdFiles } = context.reviewConfig;

  const rulesSection =
    rules.length > 0
      ? rules.map((r, i) => `${i + 1}. ${r}`).join("\n")
      : "No REVIEW.md rules defined.";

  const claudeMdSection =
    claudeMdFiles.length > 0
      ? claudeMdFiles
          .map(
            (entry) =>
              `### CLAUDE.md${entry.path ? ` (${entry.path}/)` : " (root)"}\n${entry.content}`
          )
          .join("\n\n")
      : "";

  return `You are a code review assistant focused on enforcing project conventions and catching maintainability issues.

OBJECTIVE:
Check the PR diff against the project-specific rules and CLAUDE.md guidelines below. Flag violations with HIGH CONFIDENCE only. This is not a bug review or security review — focus on conventions and code quality.

CRITICAL INSTRUCTIONS:
1. Your PRIMARY obligation is to check violations of the project-specific rules and CLAUDE.md guidelines.
2. Only flag issues you are genuinely confident about.
3. Use "nit" for most style issues, including all CLAUDE.md violations. Use "warning" only for significant maintainability concerns.
4. NEVER use "critical" for style issues.
5. Only review CHANGED lines. Do not flag pre-existing issues.
6. Do NOT flag: missing tests, missing docs, TODO comments, personal style preferences not in the rules.
7. BIDIRECTIONAL CHECK: If the PR changes code in a way that makes a CLAUDE.md statement outdated or incorrect, flag that the CLAUDE.md file needs updating too.

PROJECT-SPECIFIC RULES (from REVIEW.md):
${rulesSection}
${claudeMdSection ? `\nPROJECT GUIDELINES (from CLAUDE.md):\nCLAUDE.md files contain project-wide instructions. Newly-introduced violations should be flagged as nit-level findings. CLAUDE.md files apply hierarchically — rules in a subdirectory's CLAUDE.md apply only to files under that path.\n\n${claudeMdSection}\n` : ""}
CODEBASE EXPLORATION:
You have access to the full repository via Read, Grep, and Glob tools. Use them to:
- Read surrounding code to understand existing conventions (naming, patterns, structure)
- Grep for similar patterns elsewhere in the codebase to check consistency
- Verify that the PR follows the same style as the rest of the project

ADDITIONAL CHECKS (only if clear violations):
- Anti-patterns and obvious code smells in the changed code
- Naming inconsistencies within the diff itself
- Obvious dead code introduced by the diff
- Unnecessarily complex code that has a clear simpler alternative

OUTPUT FORMAT:

Output a JSON array inside a \`\`\`json code fence. Each finding:
{
  "file": "relative/path/to/file",
  "startLine": <number>,
  "endLine": <number>,
  "severity": "warning" | "nit",
  "category": "style",
  "title": "<one-line summary>",
  "description": "### What the issue is\\n\\n<Explain the convention violation. Reference specific code with inline \`backticks\`. Cite the rule number if applicable.>\\n\\n### Impact and fix\\n\\n**Impact:** <Why this matters for the codebase.>\\n**Fix:** <Show the corrected code.>",
  "reasoning": "<your analysis>",
  "suggestedFix": null
}

If you find no style issues, output: \`\`\`json\n[]\n\`\`\``;
}

function buildUserPrompt(context: PRContext): string {
  let prompt = `Review this pull request for style and convention issues.\n\n`;
  prompt += `## PR Title: ${context.title}\n`;
  prompt += `## PR Description:\n${context.body || "(no description)"}\n\n`;
  prompt += `## Diff:\n\`\`\`diff\n${context.diff}\n\`\`\`\n`;

  if (context.repoDir) {
    prompt += `\n## Codebase Access\nThe full repository is available at your working directory. Use Read, Grep, and Glob tools to check existing conventions and patterns in the codebase.\n`;
  }

  if (context.reviewConfig.customInstructions) {
    prompt += `\n## Additional Review Instructions:\n${context.reviewConfig.customInstructions}\n`;
  }

  return prompt;
}

export async function runStyleChecker(
  context: PRContext
): Promise<AgentResult> {
  const start = Date.now();
  try {
    const findings = await runAgent({
      name: "style-checker",
      systemPrompt: buildSystemPrompt(context),
      userPrompt: buildUserPrompt(context),
      cwd: context.repoDir,
      model: context.modelConfig.model,
      effort: context.modelConfig.effort,
      apiKey: context.modelConfig.apiKey,
    });
    return {
      agentName: "style-checker",
      findings,
      duration: Date.now() - start,
    };
  } catch (err) {
    return {
      agentName: "style-checker",
      findings: [],
      duration: Date.now() - start,
      error: String(err),
    };
  }
}
