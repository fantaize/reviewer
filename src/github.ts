import { Octokit } from "@octokit/rest";
import { createAppAuth } from "@octokit/auth-app";
import type { ChangedFile } from "./agents/types.js";
import fs from "node:fs";

interface AppConfig {
  appId: string;
  privateKeyPath: string;
}

// Cache the app slug so we only fetch it once
let cachedAppSlug: string | undefined;

/**
 * Get the GitHub App's slug (used for @mention detection).
 * Users mention the bot as @{slug}, e.g. @my-code-reviewer.
 */
export async function getAppSlug(config: AppConfig): Promise<string> {
  if (cachedAppSlug) return cachedAppSlug;

  const privateKey = fs.readFileSync(config.privateKeyPath, "utf-8");
  const appOctokit = new Octokit({
    authStrategy: createAppAuth,
    auth: { appId: config.appId, privateKey },
  });

  const { data } = await appOctokit.rest.apps.getAuthenticated();
  cachedAppSlug = data!.slug ?? data!.name;
  return cachedAppSlug;
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
 * Uses REQUEST_CHANGES when findings exist, APPROVE when clean.
 * After posting, reacts to each inline comment with 👀 and 👎.
 */
export async function postReview(
  octokit: Octokit,
  owner: string,
  repo: string,
  pullNumber: number,
  commitSha: string,
  comments: ReviewComment[],
  summary: string,
  event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT" = "REQUEST_CHANGES"
): Promise<void> {
  const review = await octokit.rest.pulls.createReview({
    owner,
    repo,
    pull_number: pullNumber,
    commit_id: commitSha,
    event,
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

  // React to each inline comment with 👀 and 👎
  if (comments.length > 0) {
    try {
      const reviewComments = await octokit.rest.pulls.listCommentsForReview({
        owner,
        repo,
        pull_number: pullNumber,
        review_id: review.data.id,
      });
      for (const comment of reviewComments.data) {
        try {
          await octokit.rest.reactions.createForPullRequestReviewComment({
            owner, repo, comment_id: comment.id, content: "eyes",
          });
          await octokit.rest.reactions.createForPullRequestReviewComment({
            owner, repo, comment_id: comment.id, content: "-1",
          });
        } catch {
          // Non-critical
        }
      }
    } catch {
      // Non-critical
    }
  }
}

/**
 * Post a standalone comment on a pull request.
 * Returns the comment ID so it can be updated or deleted later.
 */
export async function postSummaryComment(
  octokit: Octokit,
  owner: string,
  repo: string,
  pullNumber: number,
  body: string
): Promise<number> {
  const response = await octokit.rest.issues.createComment({
    owner,
    repo,
    issue_number: pullNumber,
    body,
  });
  return response.data.id;
}

/**
 * Delete a comment by ID.
 */
export async function deleteComment(
  octokit: Octokit,
  owner: string,
  repo: string,
  commentId: number
): Promise<void> {
  await octokit.rest.issues.deleteComment({
    owner,
    repo,
    comment_id: commentId,
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
 * Create a GitHub Check Run for the review.
 */
export async function createCheckRun(
  octokit: Octokit,
  owner: string,
  repo: string,
  headSha: string
): Promise<number> {
  const response = await octokit.rest.checks.create({
    owner,
    repo,
    name: "Claude Code Review",
    head_sha: headSha,
    status: "in_progress",
    started_at: new Date().toISOString(),
  });
  return response.data.id;
}

/**
 * Update a check run with completion status.
 */
export async function updateCheckRun(
  octokit: Octokit,
  owner: string,
  repo: string,
  checkRunId: number,
  conclusion: "success" | "neutral" | "failure",
  summary: string,
  findingsCount: number
): Promise<void> {
  await octokit.rest.checks.update({
    owner,
    repo,
    check_run_id: checkRunId,
    status: "completed",
    conclusion,
    completed_at: new Date().toISOString(),
    output: {
      title: findingsCount > 0
        ? `${findingsCount} issue${findingsCount !== 1 ? "s" : ""} found`
        : "No issues found",
      summary,
    },
  });
}

/**
 * Resolve (hide/minimize) outdated review comments from previous reviews
 * and dismiss any REQUEST_CHANGES reviews from the bot.
 * Uses GraphQL to minimize comments as "OUTDATED".
 */
export async function resolveOutdatedComments(
  octokit: Octokit,
  owner: string,
  repo: string,
  pullNumber: number
): Promise<number> {
  // Get all review comments on the PR
  const comments = await octokit.paginate(
    octokit.rest.pulls.listReviewComments,
    { owner, repo, pull_number: pullNumber, per_page: 100 }
  );

  // Find comments from our bot that contain review findings
  const botComments = comments.filter(
    (c) =>
      (c as Record<string, unknown>).performed_via_github_app != null ||
      c.body.includes("Extended reasoning\u2026") // our signature
  );

  // Get the PR's review threads via GraphQL so we can resolve them
  let threadMap = new Map<number, string>(); // comment ID → thread node ID
  try {
    const prData: any = await octokit.graphql(
      `query($owner: String!, $repo: String!, $pr: Int!) {
        repository(owner: $owner, name: $repo) {
          pullRequest(number: $pr) {
            reviewThreads(first: 100) {
              nodes {
                id
                isResolved
                comments(first: 1) {
                  nodes { databaseId }
                }
              }
            }
          }
        }
      }`,
      { owner, repo, pr: pullNumber }
    );
    const threads = prData.repository.pullRequest.reviewThreads.nodes;
    for (const thread of threads) {
      if (!thread.isResolved && thread.comments.nodes.length > 0) {
        threadMap.set(thread.comments.nodes[0].databaseId, thread.id);
      }
    }
  } catch (err) {
    console.warn("[resolve] Failed to fetch review threads via GraphQL:", err);
  }

  console.log(`[resolve] Found ${botComments.length} bot comment(s), ${threadMap.size} unresolved thread(s)`);

  let resolved = 0;
  for (const comment of botComments) {
    try {
      // React with 👍 to indicate the issue is resolved
      await octokit.rest.reactions.createForPullRequestReviewComment({
        owner, repo, comment_id: comment.id, content: "+1",
      });
    } catch {
      // Non-critical
    }
    // Resolve the review thread
    const threadId = threadMap.get(comment.id);
    if (threadId) {
      try {
        await octokit.graphql(
          `mutation($threadId: ID!) {
            resolveReviewThread(input: {threadId: $threadId}) {
              thread { isResolved }
            }
          }`,
          { threadId }
        );
        resolved++;
      } catch (err) {
        console.warn(`[resolve] Failed to resolve thread for comment ${comment.id}:`, err);
      }
    } else {
      console.log(`[resolve] No thread found for comment ${comment.id}`);
    }
  }

  // Dismiss any outstanding REQUEST_CHANGES reviews from the bot
  try {
    const reviews = await octokit.rest.pulls.listReviews({
      owner, repo, pull_number: pullNumber,
    });
    for (const review of reviews.data) {
      if (
        review.state === "CHANGES_REQUESTED" &&
        (review as Record<string, unknown>).performed_via_github_app != null
      ) {
        try {
          await octokit.rest.pulls.dismissReview({
            owner, repo, pull_number: pullNumber,
            review_id: review.id,
            message: "Outdated review dismissed — new push received, re-reviewing.",
          });
          resolved++;
        } catch {
          // May not have permission
        }
      }
    }
  } catch {
    // Non-critical
  }

  return resolved;
}

/**
 * Post a reaction on a comment to acknowledge processing.
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

/**
 * Post a reaction on a PR/issue to acknowledge processing.
 */
export async function postPRReaction(
  octokit: Octokit,
  owner: string,
  repo: string,
  issueNumber: number,
  reaction: "+1" | "-1" | "eyes" | "rocket" | "heart" = "eyes"
): Promise<void> {
  await octokit.rest.reactions.createForIssue({
    owner,
    repo,
    issue_number: issueNumber,
    content: reaction,
  });
}

