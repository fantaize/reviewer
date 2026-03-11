import { query } from "@anthropic-ai/claude-agent-sdk";
import type { Finding } from "./types.js";
import { randomUUID } from "node:crypto";

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
    const result = query({
      prompt: config.userPrompt,
      options: {
        systemPrompt: config.systemPrompt,
        model: config.model ?? "claude-opus-4-6",
        maxTurns: config.maxTurns ?? (hasCodebase ? 20 : 10),
        permissionMode: "dontAsk",
        allowedTools: hasCodebase ? ["Read", "Grep", "Glob"] : [],
        ...(hasCodebase ? { cwd: config.cwd } : {}),
        ...(config.effort ? { effort: config.effort } : {}),
        ...(config.apiKey ? { env: { ANTHROPIC_API_KEY: config.apiKey } } : {}),
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
        `  2. Run "claude auth login" on this machine to authenticate Claude Code\n` +
        `  Check status with: claude auth status --text`
      );
    }

    console.error(`[${config.name}] Agent execution failed:`, err);
    return [];
  }

  const findings = extractFindings(fullText, config.name);
  return findings;
}

/**
 * Extract JSON findings array from agent text output.
 * Looks for the last ```json ... ``` fenced block.
 */
function extractFindings(text: string, agentName: string): Finding[] {
  const jsonBlocks = [...text.matchAll(/```json\s*\n([\s\S]*?)```/g)];

  if (jsonBlocks.length === 0) {
    // Try parsing the entire text as JSON as fallback
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

  // Use the last JSON block (most likely the final output)
  const lastBlock = jsonBlocks[jsonBlocks.length - 1];
  try {
    const parsed = JSON.parse(lastBlock[1]);
    if (!Array.isArray(parsed)) {
      console.warn(`[${agentName}] JSON block is not an array`);
      return [];
    }
    return normalizeFindings(parsed, agentName);
  } catch (err) {
    console.warn(`[${agentName}] Failed to parse JSON:`, err);
    return [];
  }
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
