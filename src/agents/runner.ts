import { query } from "@anthropic-ai/claude-agent-sdk";
import type { Finding } from "./types.js";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { getClaudePath } from "./utils.js";

export interface AgentConfig {
  name: string;
  systemPrompt: string;
  userPrompt: string;
  model?: string;
  maxTurns?: number;
  cwd?: string;
  effort?: "low" | "medium" | "high" | "max";
  apiKey?: string;
}

/**
 * Run a single Claude agent and extract structured findings from its response.
 * Uses the Claude Agent SDK query() function.
 */
export async function runAgent(config: AgentConfig): Promise<Finding[]> {
  let fullText = "";

  try {
    const hasCodebase = !!config.cwd;

    // Build env: spread process.env and unset CLAUDECODE to avoid
    // "nested session" error. The SDK replaces env entirely, not merges.
    const agentEnv: Record<string, string | undefined> = {
      ...process.env,
      CLAUDECODE: "",
    };
    if (config.apiKey) {
      agentEnv.ANTHROPIC_API_KEY = config.apiKey;
    }

    const result = query({
      prompt: config.userPrompt,
      options: {
        systemPrompt: config.systemPrompt,
        model: config.model ?? "claude-opus-4-6",
        maxTurns: config.maxTurns ?? (hasCodebase ? 20 : 10),
        permissionMode: "dontAsk",
        allowedTools: hasCodebase ? ["Read", "Grep", "Glob"] : [],
        env: agentEnv,
        pathToClaudeCodeExecutable: getClaudePath(),
        stderr: (data: string) => {
          console.error(`[${config.name}:stderr] ${data.trim()}`);
        },
        ...(hasCodebase ? { cwd: config.cwd } : {}),
        ...(config.effort ? { effort: config.effort } : {}),
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
      if (message.type === "result") {
        if (message.subtype === "success" && message.result) {
          fullText += "\n" + message.result;
        }
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);

    // Detect auth failures and surface them clearly
    if (/auth|unauthorized|token|login|credential|401|403/i.test(msg)) {
      console.error(
        `[${config.name}] Authentication failed. Either:\n` +
        `  1. Set ANTHROPIC_API_KEY in your .env file, or\n` +
        `  2. Run "claude setup-token" on this machine to authenticate Claude Code\n` +
        `  Check status with: claude auth status --text`
      );
    }

    console.error(`[${config.name}] Agent execution failed:`, err);
    return [];
  }

  // Debug: dump raw output for inspection
  try { writeFileSync(`/tmp/reviewer-${config.name}-output.txt`, fullText); } catch {}
  console.log(`[${config.name}] Raw output: ${fullText.length} chars`);

  const findings = extractFindings(fullText, config.name);
  return findings;
}

/**
 * Extract JSON findings array from agent text output.
 * Agent descriptions often contain embedded triple-backtick code blocks,
 * so a naive ```json...``` regex won't work. Instead we:
 * 1. Find each ```json marker
 * 2. Locate the opening '[' of the array
 * 3. Use bracket-depth counting (respecting JSON strings) to find the matching ']'
 * 4. Try to parse the extracted array
 */
function extractFindings(text: string, agentName: string): Finding[] {
  // Find all ```json markers and try to extract a valid JSON array from each
  const marker = "```json";
  const candidates: string[] = [];
  let searchFrom = 0;

  while (true) {
    const markerIdx = text.indexOf(marker, searchFrom);
    if (markerIdx === -1) break;

    // Skip past the marker and any whitespace/newline
    let start = markerIdx + marker.length;
    while (start < text.length && (text[start] === " " || text[start] === "\n" || text[start] === "\r")) {
      start++;
    }

    // Look for the opening '[' of a JSON array
    if (start < text.length && text[start] === "[") {
      const arrayStr = extractJsonArray(text, start);
      if (arrayStr) {
        candidates.push(arrayStr);
      }
    }

    searchFrom = start + 1;
  }

  // Try candidates in reverse order (last one is most likely the final output)
  for (let i = candidates.length - 1; i >= 0; i--) {
    try {
      const parsed = JSON.parse(candidates[i]);
      if (Array.isArray(parsed) && parsed.length > 0) {
        console.log(`[${agentName}] Extracted JSON array with ${parsed.length} item(s)`);
        return normalizeFindings(parsed, agentName);
      }
    } catch {
      // Try repair on this candidate
      const repaired = repairTruncatedJsonArray(candidates[i]);
      if (repaired.length > 0) {
        console.log(`[${agentName}] Repaired truncated JSON, recovered ${repaired.length} finding(s)`);
        return normalizeFindings(repaired, agentName);
      }
    }
  }

  // Fallback: try parsing the entire text as JSON
  try {
    const parsed = JSON.parse(text.trim());
    if (Array.isArray(parsed)) {
      return normalizeFindings(parsed, agentName);
    }
  } catch {
    // Not JSON
  }

  console.warn(`[${agentName}] No JSON findings found in response`);
  return [];
}

/**
 * Extract a JSON array starting at position `start` in `text`.
 * Uses bracket/brace depth counting while respecting JSON string literals.
 * Returns the substring from '[' to the matching ']', or null if not found.
 */
function extractJsonArray(text: string, start: number): string | null {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (ch === "\\" && inString) {
      escaped = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === "[" || ch === "{") {
      depth++;
    } else if (ch === "]" || ch === "}") {
      depth--;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }

  // Array was truncated — return what we have for repair attempts
  return text.slice(start);
}

/**
 * Attempt to recover complete objects from a truncated JSON array.
 * Finds each complete {...} object in the array text.
 */
function repairTruncatedJsonArray(text: string): Record<string, unknown>[] {
  const results: Record<string, unknown>[] = [];

  // Find all complete top-level objects by tracking brace depth
  let depth = 0;
  let inString = false;
  let escaped = false;
  let objectStart = -1;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (ch === "\\") {
      escaped = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === "{") {
      if (depth === 0) objectStart = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && objectStart !== -1) {
        const objStr = text.slice(objectStart, i + 1);
        try {
          const obj = JSON.parse(objStr);
          if (typeof obj === "object" && obj !== null) {
            results.push(obj as Record<string, unknown>);
          }
        } catch {
          // This object is also malformed, skip
        }
        objectStart = -1;
      }
    }
  }

  return results;
}

/**
 * Normalize raw parsed findings, adding IDs and agent source.
 */
function normalizeFindings(
  raw: Record<string, unknown>[],
  agentName: string
): Finding[] {
  return raw
    .filter(
      (item) =>
        typeof item.file === "string" &&
        typeof item.startLine === "number" &&
        typeof item.title === "string"
    )
    .map((item) => ({
      id: randomUUID(),
      file: item.file as string,
      startLine: item.startLine as number,
      endLine: (item.endLine as number) ?? (item.startLine as number),
      severity: validateSeverity(item.severity),
      category: validateCategory(item.category),
      title: item.title as string,
      description: (item.description as string) ?? "",
      reasoning: (item.reasoning as string) ?? "",
      suggestedFix: item.suggestedFix as string | undefined,
      confidence: item.confidence as number | undefined,
      agentSource: agentName,
    }));
}

function validateSeverity(
  val: unknown
): "critical" | "warning" | "nit" | "pre-existing" {
  const valid = ["critical", "warning", "nit", "pre-existing"];
  return valid.includes(val as string)
    ? (val as "critical" | "warning" | "nit" | "pre-existing")
    : "warning";
}

function validateCategory(
  val: unknown
): "bug" | "security" | "style" | "performance" {
  const valid = ["bug", "security", "style", "performance"];
  return valid.includes(val as string)
    ? (val as "bug" | "security" | "style" | "performance")
    : "bug";
}
