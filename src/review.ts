import type { Octokit } from "@octokit/rest";
import type { PRContext, ModelConfig } from "./agents/types.js";
import { fetchPRDiff, fetchChangedFiles, postReview, postSummaryComment, getInstallationToken, createCheckRun, updateCheckRun } from "./github.js";
import { loadReviewConfig } from "./config.js";
import { orchestrate } from "./agents/orchestrator.js";
import { buildReviewComments, buildReviewBody } from "./formatter.js";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface ReviewOptions {
  confidenceThreshold: number;
  reviewInstructions?: string;
  modelConfig: ModelConfig;
}

/**
 * Run the full review pipeline for a pull request.
 */
export async function runReview(
  octokit: Octokit,
  owner: string,
  repo: string,
  pullNumber: number,
  options: ReviewOptions
): Promise<{ findingsCount: number; duration: number }> {
  const start = Date.now();

  console.log(`[review] Starting review for ${owner}/${repo}#${pullNumber}`);

  // 1. Fetch PR metadata
  const pr = await octokit.rest.pulls.get({
    owner,
    repo,
    pull_number: pullNumber,
  });

  // Create check run
  let checkRunId: number | undefined;
  try {
    checkRunId = await createCheckRun(octokit, owner, repo, pr.data.head.sha);
    console.log(`[review] Created check run ${checkRunId}`);
  } catch (err) {
    console.warn("[review] Failed to create check run (may lack checks permission):", err);
  }

  // 2. Fetch diff and changed files in parallel (reviewConfig loaded after clone)
  const [diff, changedFiles] = await Promise.all([
    fetchPRDiff(octokit, owner, repo, pullNumber),
    fetchChangedFiles(octokit, owner, repo, pullNumber),
  ]);

  // Guard: skip very large PRs
  if (diff.length > 200_000) {
    const msg = "This PR is too large for automated review (diff exceeds 200KB). Please consider breaking it into smaller PRs.";
    await postSummaryComment(octokit, owner, repo, pullNumber, msg);
    if (checkRunId) {
      try {
        await updateCheckRun(octokit, owner, repo, checkRunId, "neutral", msg, 0);
      } catch {}
    }
    return { findingsCount: 0, duration: Date.now() - start };
  }

  // 3. Clone repo for codebase exploration
  let repoDir: string | undefined;
  try {
    const token = await getInstallationToken(octokit);
    repoDir = mkdtempSync(join(tmpdir(), `reviewer-${owner}-${repo}-`));
    const cloneUrl = `https://x-access-token:${token}@github.com/${owner}/${repo}.git`;
    console.log(`[review] Cloning ${owner}/${repo} to ${repoDir}...`);
    execSync(
      `git clone --depth 1 "${cloneUrl}" "${repoDir}"`,
      { stdio: "pipe", timeout: 120_000 }
    );
    // Fetch the PR head commit specifically (shallow clone may not include it)
    execSync(`git fetch origin ${pr.data.head.sha} --depth 1`, {
      cwd: repoDir,
      stdio: "pipe",
    });
    execSync(`git checkout ${pr.data.head.sha}`, {
      cwd: repoDir,
      stdio: "pipe",
    });
    console.log(`[review] Clone complete, checked out ${pr.data.head.sha.slice(0, 8)}`);
  } catch (err) {
    console.warn("[review] Failed to clone repo, proceeding without codebase access:", err);
    if (repoDir) {
      try { rmSync(repoDir, { recursive: true, force: true }); } catch {}
    }
    repoDir = undefined;
  }

  // 4. Load review config (after clone so CLAUDE.md files can be discovered)
  const reviewConfig = await loadReviewConfig(
    octokit, owner, repo, pr.data.head.sha,
    {
      confidenceThreshold: options.confidenceThreshold,
      reviewInstructions: options.reviewInstructions,
    },
    repoDir
  );

  // 5. Build context
  const context: PRContext = {
    owner,
    repo,
    pullNumber,
    title: pr.data.title,
    body: pr.data.body ?? "",
    baseSha: pr.data.base.sha,
    headSha: pr.data.head.sha,
    diff,
    changedFiles,
    reviewConfig,
    installationId: pr.data.base.repo.owner.id,
    repoDir,
    modelConfig: options.modelConfig,
  };

  // 6. Run multi-agent orchestration
  let findings: Awaited<ReturnType<typeof orchestrate>>["findings"];
  let summary: Awaited<ReturnType<typeof orchestrate>>["summary"];
  try {
    const result = await orchestrate(context, {
      confidenceThreshold: options.confidenceThreshold,
    });
    findings = result.findings;
    summary = result.summary;
  } catch (err) {
    // Mark check run as failed
    if (checkRunId) {
      try {
        await updateCheckRun(
          octokit, owner, repo, checkRunId, "failure",
          `Review failed: ${err instanceof Error ? err.message : "Unknown error"}`, 0
        );
      } catch {}
    }
    throw err;
  } finally {
    // Clean up cloned repo
    if (repoDir) {
      try {
        rmSync(repoDir, { recursive: true, force: true });
        console.log(`[review] Cleaned up cloned repo at ${repoDir}`);
      } catch (err) {
        console.warn("[review] Failed to clean up cloned repo:", err);
      }
    }
  }

  const totalDuration = Date.now() - start;

  // 7. Format findings
  const { inlineComments, overflowFindings } = buildReviewComments(
    findings,
    diff
  );

  // 8. Build review body and post
  const reviewBody = buildReviewBody(findings, overflowFindings, totalDuration, summary);

  if (findings.length > 0) {
    try {
      await postReview(
        octokit,
        owner,
        repo,
        pullNumber,
        pr.data.head.sha,
        inlineComments,
        reviewBody,
        "REQUEST_CHANGES"
      );
      console.log(
        `[review] Posted review with ${inlineComments.length} inline comments (requested changes)`
      );
    } catch (err) {
      console.error("[review] Failed to post review:", err);
    }
  } else {
    // No issues — approve the PR
    try {
      await postReview(
        octokit,
        owner,
        repo,
        pullNumber,
        pr.data.head.sha,
        [],
        reviewBody,
        "APPROVE"
      );
      console.log("[review] Approved PR (no issues found)");
    } catch (err) {
      console.error("[review] Failed to approve:", err);
    }
  }

  // Update check run
  if (checkRunId) {
    try {
      const checkSummary = findings.length > 0
        ? `Found ${findings.length} issue${findings.length !== 1 ? "s" : ""} in ${formatDuration(totalDuration)}.`
        : `No issues found in ${formatDuration(totalDuration)}.`;
      await updateCheckRun(
        octokit, owner, repo, checkRunId,
        findings.length > 0 ? "neutral" : "success",
        checkSummary,
        findings.length
      );
    } catch (err) {
      console.warn("[review] Failed to update check run:", err);
    }
  }

  console.log(
    `[review] Completed: ${findings.length} findings in ${formatDuration(totalDuration)}`
  );

  return { findingsCount: findings.length, duration: totalDuration };
}

function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}
