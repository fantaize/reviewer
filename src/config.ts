import type { Octokit } from "@octokit/rest";
import type { ReviewConfig } from "./agents/types.js";

const DEFAULT_CONFIG: ReviewConfig = {
  rules: [],
  ignorePatterns: [],
  customInstructions: "",
  confidenceThreshold: 80,
};

/**
 * Fetch and parse REVIEW.md from the repository root.
 * Returns default config if the file doesn't exist.
 */
export async function loadReviewConfig(
  octokit: Octokit,
  owner: string,
  repo: string,
  ref: string,
  overrides: { confidenceThreshold?: number; reviewInstructions?: string }
): Promise<ReviewConfig> {
  let content: string;
  try {
    const response = await octokit.rest.repos.getContent({
      owner,
      repo,
      path: "REVIEW.md",
      ref,
    });

    if ("content" in response.data && response.data.content) {
      content = Buffer.from(response.data.content, "base64").toString("utf-8");
    } else {
      return applyOverrides(DEFAULT_CONFIG, overrides);
    }
  } catch {
    // REVIEW.md doesn't exist — use defaults
    return applyOverrides(DEFAULT_CONFIG, overrides);
  }

  return applyOverrides(parseReviewMd(content), overrides);
}

/**
 * Parse REVIEW.md markdown into ReviewConfig.
 * Expected sections: ## Rules, ## Ignore Patterns, ## Custom Instructions
 */
function parseReviewMd(content: string): ReviewConfig {
  const config: ReviewConfig = { ...DEFAULT_CONFIG };

  const sections = content.split(/^## /m);

  for (const section of sections) {
    const firstNewline = section.indexOf("\n");
    if (firstNewline === -1) continue;

    const header = section.slice(0, firstNewline).trim().toLowerCase();
    const body = section.slice(firstNewline + 1).trim();

    if (header === "rules") {
      config.rules = extractListItems(body);
    } else if (header === "ignore patterns") {
      config.ignorePatterns = extractListItems(body);
    } else if (header === "custom instructions") {
      config.customInstructions = body;
    }
  }

  return config;
}

function extractListItems(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.replace(/^[-*]\s*/, "").trim())
    .filter(Boolean);
}

function applyOverrides(
  config: ReviewConfig,
  overrides: { confidenceThreshold?: number; reviewInstructions?: string }
): ReviewConfig {
  return {
    ...config,
    confidenceThreshold:
      overrides.confidenceThreshold ?? config.confidenceThreshold,
    customInstructions: [config.customInstructions, overrides.reviewInstructions]
      .filter(Boolean)
      .join("\n\n"),
  };
}
