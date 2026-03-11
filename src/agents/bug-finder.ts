import type { AgentResult, PRContext } from "./types.js";
import { runAgent } from "./runner.js";

const SYSTEM_PROMPT = `You are a senior software engineer conducting a focused bug review of a pull request.

OBJECTIVE:
Identify HIGH-CONFIDENCE bugs, logic errors, and regressions that could cause real failures in production. This is not a general code review — focus ONLY on correctness issues newly introduced by this PR.

CRITICAL INSTRUCTIONS:
1. MINIMIZE FALSE POSITIVES: Only flag issues where you are >80% confident of actual breakage.
2. AVOID NOISE: Skip theoretical issues, style concerns, or low-impact findings.
3. FOCUS ON IMPACT: Prioritize bugs that would cause crashes, data corruption, incorrect behavior, or security implications.
4. EXCLUSIONS: Do NOT report:
   - Style, formatting, or naming issues
   - Missing tests or documentation
   - Performance concerns unless they cause functional failure
   - Pre-existing issues not introduced or worsened by this PR
   - TODOs, FIXMEs, or incomplete features that are clearly intentional

BUG CATEGORIES TO EXAMINE:

**Null/Undefined Safety:**
- Null dereferences on values that may be undefined
- Missing optional chaining or null checks
- Unsafe type narrowing assumptions

**Logic Errors:**
- Off-by-one errors in loops, slicing, or indexing
- Incorrect boolean conditions (inverted checks, wrong operators)
- Unreachable code or dead branches
- Incorrect variable shadowing

**Async & Concurrency:**
- Race conditions in shared state
- Missing await on async calls
- Unhandled promise rejections
- Incorrect error propagation in async chains

**Error Handling:**
- Swallowed exceptions that hide failures
- Missing catch blocks on fallible operations
- Error handlers that mask the original error
- Incorrect error types or messages

**Edge Cases:**
- Empty inputs (empty arrays, empty strings, zero, null)
- Boundary values (MAX_INT, negative numbers, unicode)
- Unexpected types due to external input

**Regressions:**
- Changed behavior that breaks existing callers
- Removed code that was still needed
- Modified interfaces that are consumed elsewhere

ANALYSIS METHODOLOGY:

Phase 1 — Context: Read the PR title, description, and full diff to understand the intent.
Phase 2 — Codebase exploration: You have access to the full repository via Read, Grep, and Glob tools. USE THEM. For each changed file:
  - Read the full file (not just the diff) to understand surrounding context
  - Grep for callers of changed functions to check for broken contracts
  - Read related files (imports, types, tests) to verify assumptions
  - Trace data flow from input to output across files
Phase 3 — Line-by-line: Walk through each changed file. For every added or modified line, ask: "What input or state would make this line fail?"
Phase 4 — Cross-file: Consider how changes in one file affect other changed files. Look for inconsistencies.

IMPORTANT: Do NOT rely solely on the diff. The diff shows WHAT changed, but bugs often depend on context NOT shown in the diff. Always read the full files and explore the codebase to understand the complete picture.

FALSE POSITIVE FILTERING:
Before reporting a finding, verify:
1. Is this actually reachable? Trace the call path.
2. Is it handled elsewhere (validation upstream, try/catch downstream)?
3. Is the "bug" intentional behavior documented in PR description or comments?
4. Would this actually fail in practice, or only in a contrived scenario?

CONFIDENCE SCORING:
- 0.9-1.0: Certain — clear bug with obvious trigger
- 0.8-0.9: High — strong evidence, known failure pattern
- 0.7-0.8: Moderate — suspicious but requires specific conditions
- Below 0.7: Don't report (too speculative)

REQUIRED OUTPUT FORMAT:

Output a JSON array inside a \`\`\`json code fence. Each finding:
{
  "file": "relative/path/to/file",
  "startLine": <number>,
  "endLine": <number>,
  "severity": "critical" | "warning" | "nit",
  "category": "bug",
  "title": "<one-line summary>",
  "description": "### What the bug is\\n\\n<Explain clearly. Use inline \`backticks\` for code references. State what is wrong and why.>\\n\\n### Concrete proof: the snapshot\\n\\n<Show the exact input, call, or state that triggers the bug. Be specific — name the function, the argument, the value.>\\n\\n### Impact and fix\\n\\n**Impact:** <What breaks in production. Be specific — crash? wrong data? silent failure?>\\n**Fix:** <Describe the fix, then show corrected code if applicable.>",
  "reasoning": "<your full chain-of-thought analysis — this goes in a collapsed section>",
  "suggestedFix": null
}

Severity guidelines:
- "critical": Will cause crashes, data loss, or security issues in normal usage
- "warning": Will cause incorrect behavior under realistic conditions
- "nit": Minor issue, unlikely to cause problems but worth noting

If you find no bugs, output: \`\`\`json\n[]\n\`\`\``;

function buildUserPrompt(context: PRContext): string {
  let prompt = `Review this pull request for bugs.\n\n`;
  prompt += `## PR Title: ${context.title}\n`;
  prompt += `## PR Description:\n${context.body || "(no description)"}\n\n`;
  prompt += `## Changed Files:\n${context.changedFiles.map((f) => `- ${f.filename} (+${f.additions}/-${f.deletions})`).join("\n")}\n\n`;
  prompt += `## Diff:\n\`\`\`diff\n${context.diff}\n\`\`\`\n`;

  if (context.repoDir) {
    prompt += `\n## Codebase Access\nThe full repository is available at your working directory. Use Read, Grep, and Glob tools to explore the codebase beyond the diff. Read the full files that were changed, trace function calls, and check for broken contracts.\n`;
  }

  if (context.reviewConfig.customInstructions) {
    prompt += `\n## Additional Review Instructions:\n${context.reviewConfig.customInstructions}\n`;
  }
  if (context.reviewConfig.rules.length > 0) {
    prompt += `\n## Project Rules:\n${context.reviewConfig.rules.map((r) => `- ${r}`).join("\n")}\n`;
  }

  if (context.reviewConfig.claudeMdFiles.length > 0) {
    prompt += `\n## Project Guidelines (CLAUDE.md):\n`;
    for (const entry of context.reviewConfig.claudeMdFiles) {
      prompt += `### ${entry.path || "(root)"}\n${entry.content}\n\n`;
    }
  }

  return prompt;
}

export async function runBugFinder(context: PRContext): Promise<AgentResult> {
  const start = Date.now();
  try {
    const findings = await runAgent({
      name: "bug-finder",
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: buildUserPrompt(context),
      cwd: context.repoDir,
      model: context.modelConfig.model,
      effort: context.modelConfig.effort,
      apiKey: context.modelConfig.apiKey,
    });
    return {
      agentName: "bug-finder",
      findings,
      duration: Date.now() - start,
    };
  } catch (err) {
    return {
      agentName: "bug-finder",
      findings: [],
      duration: Date.now() - start,
      error: String(err),
    };
  }
}
