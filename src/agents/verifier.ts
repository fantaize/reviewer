import { query } from "@anthropic-ai/claude-agent-sdk";
import type { Finding, PRContext, VerifiedFinding } from "./types.js";
import { getClaudePath } from "./utils.js";

// Modeled on the verification specialist and false-positive filtering from /security-review
const SYSTEM_PROMPT = `You are a verification specialist for code review findings. Your job is not to confirm findings — it's to try to disprove them.

You have two failure patterns to avoid:
1. Rubber-stamping: accepting findings because they sound plausible without checking the actual code.
2. Being seduced by the description: a well-written finding can describe a bug that doesn't actually exist in context.

OBJECTIVE:
For each finding, determine whether it is a genuine issue or a false positive. Assign a confidence score.

VERIFICATION METHODOLOGY:

You have access to the full repository via Read, Grep, and Glob tools. USE THEM to verify or disprove each finding.

For each finding:
1. Read the finding's title, description, and reasoning carefully.
2. Read the FULL FILE containing the referenced code — not just the diff.
3. Try to DISPROVE the finding by exploring the codebase:
   - Use Grep to search for validation, error handling, or guards upstream of the reported issue
   - Read related files (callers, middleware, base classes) to check for mitigations
   - Is the "bug" actually handled by code elsewhere (not just in the diff, but anywhere in the codebase)?
   - Is there validation upstream that prevents the bad input?
   - Is there a try/catch or error handler downstream?
   - Is the behavior intentional (mentioned in PR description, comments, or conventions)?
   - Does the framework/language prevent this class of issue?
   - Is the "security issue" mitigated by middleware, auth layers, or framework defaults?
4. If you cannot disprove it after thorough exploration, it's likely genuine.

FALSE POSITIVE PATTERNS TO CHECK:
- Bug in removed code (code was deleted, so the "bug" no longer exists)
- Bug in test code that doesn't affect production
- Type system prevents the alleged null/undefined issue
- Framework handles the alleged injection (React escaping, ORM parameterization)
- Error is caught by a parent catch block not shown in the finding
- The "wrong" behavior is actually correct for the use case
- The finding misreads the code (wrong variable, wrong branch, wrong scope)

CONFIDENCE SCORING:
- 90-100: The finding is almost certainly correct. The code clearly has this issue.
- 80-89: The finding is likely correct. There may be edge cases but the core issue stands.
- 60-79: Uncertain. The finding might be correct but there are plausible mitigations.
- 40-59: Probably a false positive. The issue is likely handled elsewhere.
- 0-39: Almost certainly a false positive.

SEVERITY ADJUSTMENT:
You may adjust severity if the original agent miscategorized:
- A "normal" that is purely cosmetic → downgrade to "nit"
- A "nit" that actually causes data loss → upgrade to "normal"
- Set to "pre-existing" if the issue existed before this PR

OUTPUT FORMAT:

Output a JSON array inside a \`\`\`json code fence:
{
  "findingId": "<id of original finding>",
  "confidence": <0-100>,
  "verifierReasoning": "<Why you assigned this confidence. Be specific — reference the code.>",
  "adjustedSeverity": "normal" | "nit" | "pre-existing" | null
}

adjustedSeverity should be null if unchanged.`;

interface VerificationEntry {
  findingId: string;
  confidence: number;
  verifierReasoning: string;
  adjustedSeverity: string | null;
}

function buildVerifierPrompt(context: PRContext, findings: Finding[]): string {
  const findingsSummary = findings.map((f) => ({
    id: f.id,
    file: f.file,
    startLine: f.startLine,
    endLine: f.endLine,
    severity: f.severity,
    category: f.category,
    title: f.title,
    description: f.description,
    reasoning: f.reasoning,
    agentSource: f.agentSource,
  }));

  let prompt = `Verify these code review findings against the PR diff. Try to disprove each one.

## PR: ${context.title}

## Diff:
\`\`\`diff
${context.diff}
\`\`\`

## Findings to Verify (${findings.length}):
\`\`\`json
${JSON.stringify(findingsSummary, null, 2)}
\`\`\`
`;

  if (context.repoDir) {
    prompt += `\n## Codebase Access\nThe full repository is available at your working directory. For each finding, READ the actual source files to verify whether the issue truly exists. Use Grep to search for mitigations, upstream validation, and error handling that may disprove the finding. Do not trust the finding's description — verify against the actual code.\n`;
  }

  prompt += `\nFor each finding, try to find evidence that it is a false positive. If you cannot disprove it, assign high confidence.`;

  return prompt;
}

async function verifyBatch(
  context: PRContext,
  findings: Finding[]
): Promise<VerificationEntry[]> {
  let fullText = "";

  const hasCodebase = !!context.repoDir;

  try {
    const { modelConfig } = context;

    // Build env: spread process.env and unset CLAUDECODE to avoid
    // "nested session" error. The SDK replaces env entirely, not merges.
    const agentEnv: Record<string, string | undefined> = {
      ...process.env,
      CLAUDECODE: "",
    };
    if (modelConfig.apiKey) {
      agentEnv.ANTHROPIC_API_KEY = modelConfig.apiKey;
    }

    const result = query({
      prompt: buildVerifierPrompt(context, findings),
      options: {
        systemPrompt: SYSTEM_PROMPT,
        model: modelConfig.verifierModel ?? modelConfig.model,
        maxTurns: hasCodebase ? 8 : 3,
        permissionMode: "dontAsk",
        allowedTools: hasCodebase ? ["Read", "Grep", "Glob"] : [],
        env: agentEnv,
        pathToClaudeCodeExecutable: getClaudePath(),
        ...(hasCodebase ? { cwd: context.repoDir } : {}),
        ...(modelConfig.effort ? { effort: modelConfig.effort } : {}),
      },
    });

    for await (const message of result) {
      if (message.type === "assistant") {
        for (const block of message.message.content) {
          if (block.type === "text") {
            fullText += block.text;
          }
        }
      }
      if (message.type === "result" && message.subtype === "success") {
        fullText += "\n" + message.result;
      }
    }
  } catch (err) {
    console.error("[verifier] Agent execution failed:", err);
    return findings.map((f) => ({
      findingId: f.id,
      confidence: 75,
      verifierReasoning:
        "Verification failed — defaulting to moderate confidence",
      adjustedSeverity: null,
    }));
  }

  return extractVerifications(fullText);
}

function extractVerifications(text: string): VerificationEntry[] {
  // Use bracket-depth extraction to handle embedded backticks in output
  const jsonStr = extractLastJsonArray(text);
  if (!jsonStr) {
    console.warn("[verifier] No JSON array found in verification output");
    return [];
  }

  try {
    const parsed = JSON.parse(jsonStr);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter(
        (item: Record<string, unknown>) =>
          typeof item.findingId === "string" &&
          typeof item.confidence === "number"
      )
      .map((item: Record<string, unknown>) => ({
        findingId: item.findingId as string,
        confidence: Math.max(0, Math.min(100, item.confidence as number)),
        verifierReasoning:
          (item.verifierReasoning as string) ?? "No reasoning provided",
        adjustedSeverity: (item.adjustedSeverity as string | null) ?? null,
      }));
  } catch {
    console.warn("[verifier] Failed to parse verification JSON");
    return [];
  }
}

/**
 * Extract the last JSON array from text, using bracket-depth counting
 * to handle embedded triple-backtick code blocks in string values.
 */
function extractLastJsonArray(text: string): string | null {
  const marker = "```json";
  let lastCandidate: string | null = null;
  let searchFrom = 0;

  while (true) {
    const markerIdx = text.indexOf(marker, searchFrom);
    if (markerIdx === -1) break;

    let start = markerIdx + marker.length;
    while (start < text.length && (text[start] === " " || text[start] === "\n" || text[start] === "\r")) {
      start++;
    }

    if (start < text.length && text[start] === "[") {
      const arrayStr = extractJsonArrayAt(text, start);
      if (arrayStr) lastCandidate = arrayStr;
    }

    searchFrom = start + 1;
  }

  // Fallback: try the entire text
  if (!lastCandidate) {
    const trimmed = text.trim();
    if (trimmed.startsWith("[")) return trimmed;
  }

  return lastCandidate;
}

function extractJsonArrayAt(text: string, start: number): string | null {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    if (escaped) { escaped = false; continue; }
    if (ch === "\\" && inString) { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;

    if (ch === "[" || ch === "{") depth++;
    else if (ch === "]" || ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }

  return null;
}

/**
 * Run the verifier on all findings, batching if needed.
 */
export async function runVerifier(
  context: PRContext,
  findings: Finding[]
): Promise<VerifiedFinding[]> {
  if (findings.length === 0) return [];

  const BATCH_SIZE = 15;
  const batches: Finding[][] = [];
  for (let i = 0; i < findings.length; i += BATCH_SIZE) {
    batches.push(findings.slice(i, i + BATCH_SIZE));
  }

  const allVerifications: VerificationEntry[] = [];
  for (const batch of batches) {
    const results = await verifyBatch(context, batch);
    allVerifications.push(...results);
  }

  const verificationMap = new Map(
    allVerifications.map((v) => [v.findingId, v])
  );

  return findings.map((finding) => {
    const verification = verificationMap.get(finding.id);
    const severityMap: Record<string, VerifiedFinding["severity"]> = {
      critical: "normal", warning: "normal", normal: "normal",
      nit: "nit", "pre-existing": "pre-existing",
    };
    const adjusted = verification?.adjustedSeverity
      ? (severityMap[verification.adjustedSeverity] ?? finding.severity)
      : finding.severity;

    return {
      ...finding,
      severity: adjusted,
      confidence: verification?.confidence ?? 75,
      verifierReasoning:
        verification?.verifierReasoning ??
        "Verification data not available",
    };
  });
}
