import type { Octokit } from "@octokit/rest";
import type { ReviewConfig, ClaudeMdEntry } from "./agents/types.js";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const DEFAULT_CONFIG: ReviewConfig = {
  rules: [],
  ignorePatterns: [],
  customInstructions: "",
  confidenceThreshold: 80,
  claudeMdFiles: [],
};

/**
 * Fetch and parse REVIEW.md from the repository root.
 * Also discovers CLAUDE.md files at every directory level from the cloned repo.
 * Returns default config if neither file exists.
 */
export async function loadReviewConfig(
  octokit: Octokit,
  owner: string,
  repo: string,
  ref: string,
  overrides: { confidenceThreshold?: number; reviewInstructions?: string },
  repoDir?: string
): Promise<ReviewConfig> {
  let content: string | undefined;
  try {
    const response = await octokit.rest.repos.getContent({
      owner,
      repo,
      path: "REVIEW.md",
      ref,
    });

    if ("content" in response.data && response.data.content) {
      content = Buffer.from(response.data.content, "base64").toString("utf-8");
    }
  } catch {
    // REVIEW.md doesn't exist
  }

  const config = content ? parseReviewMd(content) : { ...DEFAULT_CONFIG };

  // Discover CLAUDE.md files from cloned repo
  if (repoDir) {
    config.claudeMdFiles = discoverClaudeMdFiles(repoDir);
  }

  return applyOverrides(config, overrides);
}

/**
 * Recursively discover all CLAUDE.md files in the repo directory.
 * Returns entries sorted by path depth (root first).
 */
function discoverClaudeMdFiles(repoDir: string): ClaudeMdEntry[] {
  const entries: ClaudeMdEntry[] = [];
  const CLAUDE_MD = "CLAUDE.md";
  const MAX_DEPTH = 10;

  function walk(dir: string, depth: number) {
    if (depth > MAX_DEPTH) return;

    try {
      const items = readdirSync(dir);

      if (items.includes(CLAUDE_MD)) {
        const fullPath = join(dir, CLAUDE_MD);
        try {
          const content = readFileSync(fullPath, "utf-8");
          const relPath = relative(repoDir, dir);
          entries.push({ path: relPath, content });
        } catch {
          // Can't read this CLAUDE.md, skip
        }
      }

      // Recurse into subdirectories (skip common non-source dirs)
      const SKIP_DIRS = new Set([
        "node_modules", ".git", "dist", "build", ".next", "__pycache__",
        "vendor", ".venv", "venv", "target", ".cache",
      ]);

      for (const item of items) {
        if (SKIP_DIRS.has(item) || item.startsWith(".")) continue;
        const fullPath = join(dir, item);
        try {
          if (statSync(fullPath).isDirectory()) {
            walk(fullPath, depth + 1);
          }
        } catch {
          // Permission error or symlink issue, skip
        }
      }
    } catch {
      // Can't read directory, skip
    }
  }

  walk(repoDir, 0);

  // Sort by depth (root first)
  entries.sort((a, b) => {
    const depthA = a.path === "" ? 0 : a.path.split("/").length;
    const depthB = b.path === "" ? 0 : b.path.split("/").length;
    return depthA - depthB;
  });

  if (entries.length > 0) {
    console.log(`[config] Found ${entries.length} CLAUDE.md file(s): ${entries.map(e => e.path || "(root)").join(", ")}`);
  }

  return entries;
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
