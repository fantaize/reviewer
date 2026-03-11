import { Octokit } from "@octokit/rest";
import { createAppAuth } from "@octokit/auth-app";
import type { ChangedFile } from "./agents/types.js";
import fs from "node:fs";

interface AppConfig {
  appId: string;
  privateKeyPath: string;
}

export function createInstallationOctokit(
  config: AppConfig,
  installationId: number
): Octokit {
  const privateKey = fs.readFileSync(config.privateKeyPath, "utf-8");

  return new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: config.appId,
      privateKey,
      installationId,
    },
  });
}

/**
 * Fetch the raw unified diff for a pull request.
 */
export async function fetchPRDiff(
  octokit: Octokit,
  owner: string,
  repo: string,
  pullNumber: number
): Promise<string> {
  const response = await octokit.rest.pulls.get({
    owner,
    repo,
    pull_number: pullNumber,
    mediaType: { format: "diff" },
  });
  // When format is 'diff', response.data is a string
  return response.data as unknown as string;
}

/**
 * Fetch the list of changed files in a pull request.
 */
export async function fetchChangedFiles(
  octokit: Octokit,
  owner: string,
  repo: string,
  pullNumber: number
): Promise<ChangedFile[]> {
  const files: ChangedFile[] = [];
  let page = 1;

  while (true) {
    const response = await octokit.rest.pulls.listFiles({
      owner,
      repo,
      pull_number: pullNumber,
      per_page: 100,
      page,
    });

    for (const file of response.data) {
      files.push({
        filename: file.filename,
        status: file.status as ChangedFile["status"],
        additions: file.additions,
        deletions: file.deletions,
        patch: file.patch,
      });
    }

    if (response.data.length < 100) break;
    page++;
  }

  return files;
}

/**
 * Fetch full content of a file at a specific ref.
 */
export async function fetchFileContent(
  octokit: Octokit,
  owner: string,
  repo: string,
  path: string,
  ref: string
): Promise<string | null> {
  try {
    const response = await octokit.rest.repos.getContent({
      owner,
      repo,
      path,
      ref,
    });

    if ("content" in response.data && response.data.content) {
      return Buffer.from(response.data.content, "base64").toString("utf-8");
    }
    return null;
  } catch {
    return null;
  }
}

export interface ReviewComment {
  path: string;
  line: number;
  startLine?: number;
  body: string;
}

/**
 * Post a review with inline comments on a pull request.
 * Uses event: 'COMMENT' — never approves or requests changes.
 */
export async function postReview(
  octokit: Octokit,
  owner: string,
  repo: string,
  pullNumber: number,
  commitSha: string,
  comments: ReviewComment[],
  summary: string
): Promise<void> {
  await octokit.rest.pulls.createReview({
    owner,
    repo,
    pull_number: pullNumber,
    commit_id: commitSha,
    event: "COMMENT",
    body: summary,
    comments: comments.map((c) => ({
      path: c.path,
      line: c.line,
      start_line: c.startLine,
      side: "RIGHT" as const,
      start_side: c.startLine ? ("RIGHT" as const) : undefined,
      body: c.body,
    })),
  });
}

/**
 * Post a standalone comment on a pull request.
 */
export async function postSummaryComment(
  octokit: Octokit,
  owner: string,
  repo: string,
  pullNumber: number,
  body: string
): Promise<void> {
  await octokit.rest.issues.createComment({
    owner,
    repo,
    issue_number: pullNumber,
    body,
  });
}

/**
 * Get an installation access token for git clone operations.
 */
export async function getInstallationToken(
  octokit: Octokit
): Promise<string> {
  // The octokit instance is already authenticated as an installation.
  // We can get the token from the auth object.
  const auth = (await octokit.auth({ type: "installation" })) as { token: string };
  return auth.token;
}

/**
 * Post an eyes reaction on a comment to acknowledge processing.
 */
export async function postReaction(
  octokit: Octokit,
  owner: string,
  repo: string,
  commentId: number,
  reaction: "+1" | "-1" | "eyes" | "rocket" | "heart" = "eyes"
): Promise<void> {
  await octokit.rest.reactions.createForIssueComment({
    owner,
    repo,
    comment_id: commentId,
    content: reaction,
  });
}
