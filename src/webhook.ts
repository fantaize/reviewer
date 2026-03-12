import { createInstallationOctokit, postReaction, postPRReaction, resolveOutdatedComments } from "./github.js";
import { runReview, type ReviewOptions } from "./review.js";

interface AppConfig {
  appId: string;
  privateKeyPath: string;
}

export type ReviewMode = "once" | "every_push" | "manual";

interface WebhookContext {
  appConfig: AppConfig;
  reviewOptions: ReviewOptions;
  reviewMode: ReviewMode;
}

// ---------------------------------------------------------------------------
// Duplicate review prevention
// ---------------------------------------------------------------------------
const activeReviews = new Map<string, { startedAt: number }>();
const completedReviews = new Map<string, { completedAt: number }>();
const REVIEW_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const COMPLETED_RETENTION_MS = 30 * 60 * 1000; // 30 minutes

function reviewKey(owner: string, repo: string, pullNumber: number, sha: string): string {
  return `${owner}/${repo}#${pullNumber}@${sha}`;
}

function acquireReviewLock(key: string): boolean {
  const now = Date.now();

  // Clean up stale locks
  for (const [k, v] of activeReviews) {
    if (now - v.startedAt > REVIEW_TIMEOUT_MS) {
      activeReviews.delete(k);
    }
  }

  // Clean up old completed entries
  for (const [k, v] of completedReviews) {
    if (now - v.completedAt > COMPLETED_RETENTION_MS) {
      completedReviews.delete(k);
    }
  }

  // Block if active or already completed for this SHA
  if (activeReviews.has(key) || completedReviews.has(key)) {
    return false;
  }

  activeReviews.set(key, { startedAt: now });
  return true;
}

function releaseReviewLock(key: string): void {
  activeReviews.delete(key);
  completedReviews.set(key, { completedAt: Date.now() });
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/**
 * Handle pull_request events (opened, synchronize, reopened).
 */
export async function handlePullRequest(
  payload: PullRequestPayload,
  ctx: WebhookContext
): Promise<void> {
  const { action, pull_request, repository, installation } = payload;

  // Determine which actions to handle based on review mode
  const mode = ctx.reviewMode;

  if (mode === "manual") return; // manual mode doesn't respond to PR events

  const allowedActions = mode === "every_push"
    ? ["opened", "synchronize", "reopened", "ready_for_review"]
    : ["opened", "ready_for_review"]; // "once" mode

  if (!allowedActions.includes(action)) return;
  if (!installation?.id) {
    console.warn("[webhook] No installation ID in payload, skipping");
    return;
  }

  // Skip draft PRs
  if (pull_request.draft) {
    console.log(`[webhook] Skipping draft PR #${pull_request.number}`);
    return;
  }

  const owner = repository.owner.login;
  const repo = repository.name;
  const pullNumber = pull_request.number;
  const headSha = pull_request.head.sha;

  // Prevent duplicate reviews for the same commit
  const key = reviewKey(owner, repo, pullNumber, headSha);
  if (!acquireReviewLock(key)) {
    console.log(`[webhook] Review already in progress for ${key}, skipping`);
    return;
  }

  console.log(
    `[webhook] PR ${action}: ${owner}/${repo}#${pullNumber} - "${pull_request.title}"`
  );

  const octokit = createInstallationOctokit(ctx.appConfig, installation.id);

  // React with eyes to acknowledge the PR
  try {
    await postPRReaction(octokit, owner, repo, pullNumber, "eyes");
  } catch (err) {
    console.warn("[webhook] Failed to post eyes reaction:", err);
  }

  try {
    const result = await runReview(octokit, owner, repo, pullNumber, ctx.reviewOptions);
    console.log(
      `[webhook] Review complete: ${result.findingsCount} findings in ${result.duration}ms`
    );

    // After a push (synchronize), if the re-review found no issues,
    // resolve old comments and dismiss stale REQUEST_CHANGES reviews
    if (action === "synchronize" && result.findingsCount === 0) {
      try {
        const resolved = await resolveOutdatedComments(octokit, owner, repo, pullNumber);
        if (resolved > 0) {
          console.log(`[webhook] Resolved ${resolved} outdated comment(s) after clean re-review`);
        }
      } catch (err) {
        console.warn("[webhook] Failed to resolve outdated comments:", err);
      }
    }
  } catch (err) {
    console.error(`[webhook] Review failed for ${owner}/${repo}#${pullNumber}:`, err);
  } finally {
    releaseReviewLock(key);
  }
}

/**
 * Handle issue_comment events — look for /review trigger.
 */
export async function handleIssueComment(
  payload: IssueCommentPayload,
  ctx: WebhookContext
): Promise<void> {
  if (ctx.reviewMode !== "manual") return;

  const { action, comment, issue, repository, installation } = payload;

  if (action !== "created") return;
  if (!installation?.id) return;

  // Must be a PR comment (issues have no pull_request field)
  if (!issue.pull_request) return;

  // Check for /review trigger
  const body = comment.body.trim();
  if (!body.startsWith("/review")) return;

  const owner = repository.owner.login;
  const repo = repository.name;
  const pullNumber = issue.number;

  console.log(
    `[webhook] Manual review triggered by @${comment.user.login} on ${owner}/${repo}#${pullNumber}`
  );

  const octokit = createInstallationOctokit(ctx.appConfig, installation.id);

  // Acknowledge with eyes reaction
  await postReaction(octokit, owner, repo, comment.id, "eyes");

  // For manual reviews, use "manual" as SHA to allow re-review of same commit
  const key = reviewKey(owner, repo, pullNumber, `manual-${comment.id}`);
  if (!acquireReviewLock(key)) {
    console.log(`[webhook] Review already in progress for ${key}, skipping`);
    return;
  }

  // Extract optional custom instructions from comment
  const customInstructions = body.replace(/^\/review\s*/, "").trim() || undefined;

  const reviewOptions: ReviewOptions = {
    ...ctx.reviewOptions,
    reviewInstructions: customInstructions ?? ctx.reviewOptions.reviewInstructions,
  };

  try {
    const result = await runReview(octokit, owner, repo, pullNumber, reviewOptions);
    console.log(
      `[webhook] Manual review complete: ${result.findingsCount} findings`
    );
  } catch (err) {
    console.error(`[webhook] Manual review failed:`, err);
  } finally {
    releaseReviewLock(key);
  }
}

// Minimal type definitions for webhook payloads
export interface PullRequestPayload {
  action: string;
  pull_request: {
    number: number;
    title: string;
    draft: boolean;
    head: { sha: string };
    base: { sha: string };
  };
  repository: {
    name: string;
    owner: { login: string };
  };
  installation?: { id: number };
}

export interface IssueCommentPayload {
  action: string;
  comment: {
    id: number;
    body: string;
    user: { login: string };
  };
  issue: {
    number: number;
    pull_request?: unknown;
  };
  repository: {
    name: string;
    owner: { login: string };
  };
  installation?: { id: number };
}
