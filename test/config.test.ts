import { describe, it, expect, vi, beforeEach } from "vitest";
import { loadReviewConfig } from "../src/config.js";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Mock Octokit
function mockOctokit(reviewMdContent?: string) {
  return {
    rest: {
      repos: {
        getContent: vi.fn().mockImplementation(async ({ path }: { path: string }) => {
          if (path === "REVIEW.md" && reviewMdContent) {
            return {
              data: {
                content: Buffer.from(reviewMdContent).toString("base64"),
              },
            };
          }
          throw new Error("Not found");
        }),
      },
    },
  } as any;
}

describe("loadReviewConfig", () => {
  it("returns default config when no REVIEW.md exists", async () => {
    const octokit = mockOctokit();
    const config = await loadReviewConfig(octokit, "owner", "repo", "sha", {});
    expect(config.rules).toEqual([]);
    expect(config.ignorePatterns).toEqual([]);
    expect(config.customInstructions).toBe("");
    expect(config.confidenceThreshold).toBe(80);
    expect(config.claudeMdFiles).toEqual([]);
  });

  it("parses REVIEW.md rules section", async () => {
    const reviewMd = `## Rules
- Use strict TypeScript
- No console.log in production

## Ignore Patterns
- docs/**
- **/*.test.ts

## Custom Instructions
Focus on API security.`;

    const octokit = mockOctokit(reviewMd);
    const config = await loadReviewConfig(octokit, "owner", "repo", "sha", {});
    expect(config.rules).toEqual(["Use strict TypeScript", "No console.log in production"]);
    expect(config.ignorePatterns).toEqual(["docs/**", "**/*.test.ts"]);
    expect(config.customInstructions).toBe("Focus on API security.");
  });

  it("applies confidence threshold override", async () => {
    const octokit = mockOctokit();
    const config = await loadReviewConfig(octokit, "owner", "repo", "sha", {
      confidenceThreshold: 90,
    });
    expect(config.confidenceThreshold).toBe(90);
  });

  it("appends review instructions to custom instructions", async () => {
    const reviewMd = `## Custom Instructions
Base instructions.`;

    const octokit = mockOctokit(reviewMd);
    const config = await loadReviewConfig(octokit, "owner", "repo", "sha", {
      reviewInstructions: "Extra instructions",
    });
    expect(config.customInstructions).toContain("Base instructions.");
    expect(config.customInstructions).toContain("Extra instructions");
  });
});

describe("CLAUDE.md discovery", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "reviewer-test-"));
  });

  it("discovers CLAUDE.md at repo root", async () => {
    writeFileSync(join(tmpDir, "CLAUDE.md"), "# Project Rules\nUse TypeScript strict mode.");

    const octokit = mockOctokit();
    const config = await loadReviewConfig(octokit, "owner", "repo", "sha", {}, tmpDir);
    expect(config.claudeMdFiles).toHaveLength(1);
    expect(config.claudeMdFiles[0].path).toBe("");
    expect(config.claudeMdFiles[0].content).toContain("Use TypeScript strict mode");

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("discovers CLAUDE.md at multiple directory levels", async () => {
    writeFileSync(join(tmpDir, "CLAUDE.md"), "Root instructions");
    mkdirSync(join(tmpDir, "src"), { recursive: true });
    writeFileSync(join(tmpDir, "src", "CLAUDE.md"), "Src instructions");
    mkdirSync(join(tmpDir, "src", "agents"), { recursive: true });
    writeFileSync(join(tmpDir, "src", "agents", "CLAUDE.md"), "Agent instructions");

    const octokit = mockOctokit();
    const config = await loadReviewConfig(octokit, "owner", "repo", "sha", {}, tmpDir);
    expect(config.claudeMdFiles).toHaveLength(3);
    // Should be sorted by depth (root first)
    expect(config.claudeMdFiles[0].path).toBe("");
    expect(config.claudeMdFiles[1].path).toBe("src");
    expect(config.claudeMdFiles[2].path).toBe("src/agents");

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("skips node_modules and .git directories", async () => {
    writeFileSync(join(tmpDir, "CLAUDE.md"), "Root");
    mkdirSync(join(tmpDir, "node_modules", "pkg"), { recursive: true });
    writeFileSync(join(tmpDir, "node_modules", "pkg", "CLAUDE.md"), "Should be skipped");
    mkdirSync(join(tmpDir, ".git"), { recursive: true });
    writeFileSync(join(tmpDir, ".git", "CLAUDE.md"), "Should be skipped");

    const octokit = mockOctokit();
    const config = await loadReviewConfig(octokit, "owner", "repo", "sha", {}, tmpDir);
    expect(config.claudeMdFiles).toHaveLength(1);
    expect(config.claudeMdFiles[0].path).toBe("");

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns empty array when no CLAUDE.md files exist", async () => {
    const octokit = mockOctokit();
    const config = await loadReviewConfig(octokit, "owner", "repo", "sha", {}, tmpDir);
    expect(config.claudeMdFiles).toEqual([]);

    rmSync(tmpDir, { recursive: true, force: true });
  });
});
