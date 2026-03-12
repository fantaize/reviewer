import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PullRequestPayload, IssueCommentPayload } from "../src/webhook.js";

// Mock the dependencies before importing
vi.mock("../src/github.js", () => ({
  createInstallationOctokit: vi.fn(() => ({})),
  postReaction: vi.fn(),
  postPRReaction: vi.fn(),
  resolveOutdatedComments: vi.fn(() => 0),
}));

vi.mock("../src/review.js", () => ({
  runReview: vi.fn(() => Promise.resolve({ findingsCount: 0, duration: 1000 })),
}));

const { handlePullRequest, handleIssueComment } = await import("../src/webhook.js");
const { runReview } = await import("../src/review.js");
const { postReaction, resolveOutdatedComments } = await import("../src/github.js");

const baseCtx = {
  appConfig: { appId: "123", privateKeyPath: "/tmp/key.pem" },
  reviewOptions: {
    confidenceThreshold: 80,
    modelConfig: { model: "claude-opus-4-6", effort: "max" as const },
  },
  allowManualReview: true,
};

function prPayload(overrides: Partial<PullRequestPayload> = {}): PullRequestPayload {
  return {
    action: "opened",
    pull_request: {
      number: 1,
      title: "Test PR",
      draft: false,
      head: { sha: "abc123" },
      base: { sha: "def456" },
    },
    repository: { name: "repo", owner: { login: "owner" } },
    installation: { id: 42 },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("handlePullRequest", () => {
  it("skips unsupported actions", async () => {
    await handlePullRequest(prPayload({ action: "closed" }), baseCtx);
    expect(runReview).not.toHaveBeenCalled();
  });

  it("skips draft PRs", async () => {
    await handlePullRequest(
      prPayload({ pull_request: { number: 2, title: "Draft", draft: true, head: { sha: "x" }, base: { sha: "y" } } }),
      baseCtx
    );
    expect(runReview).not.toHaveBeenCalled();
  });

  it("skips when no installation ID", async () => {
    await handlePullRequest(prPayload({ installation: undefined }), baseCtx);
    expect(runReview).not.toHaveBeenCalled();
  });

  it("handles opened PRs", async () => {
    await handlePullRequest(prPayload({ pull_request: { number: 100, title: "New", draft: false, head: { sha: "unique1" }, base: { sha: "b" } } }), baseCtx);
    expect(runReview).toHaveBeenCalled();
  });

  it("handles ready_for_review action", async () => {
    await handlePullRequest(
      prPayload({
        action: "ready_for_review",
        pull_request: { number: 200, title: "Ready", draft: false, head: { sha: "unique2" }, base: { sha: "b" } },
      }),
      baseCtx
    );
    expect(runReview).toHaveBeenCalled();
  });

  it("calls resolveOutdatedComments on synchronize with 0 findings", async () => {
    await handlePullRequest(
      prPayload({
        action: "synchronize",
        pull_request: { number: 300, title: "Push", draft: false, head: { sha: "unique3" }, base: { sha: "b" } },
      }),
      baseCtx
    );
    expect(resolveOutdatedComments).toHaveBeenCalled();
    expect(runReview).toHaveBeenCalled();
  });
});

describe("handleIssueComment", () => {
  function commentPayload(body: string): IssueCommentPayload {
    return {
      action: "created",
      comment: { id: 1, body, user: { login: "dev" } },
      issue: { number: 1, pull_request: {} },
      repository: { name: "repo", owner: { login: "owner" } },
      installation: { id: 42 },
    };
  }

  it("triggers review on /review command when enabled", async () => {
    await handleIssueComment(commentPayload("/review"), baseCtx);
    expect(postReaction).toHaveBeenCalled();
    expect(runReview).toHaveBeenCalled();
  });

  it("ignores /review command when disabled", async () => {
    const disabledCtx = { ...baseCtx, allowManualReview: false };
    await handleIssueComment(commentPayload("/review"), disabledCtx);
    expect(runReview).not.toHaveBeenCalled();
  });

  it("ignores non-review comments", async () => {
    await handleIssueComment(commentPayload("looks good to me"), baseCtx);
    expect(runReview).not.toHaveBeenCalled();
  });

  it("ignores comments on issues (not PRs)", async () => {
    const payload: IssueCommentPayload = {
      action: "created",
      comment: { id: 2, body: "/review", user: { login: "dev" } },
      issue: { number: 1 },
      repository: { name: "repo", owner: { login: "owner" } },
      installation: { id: 42 },
    };
    await handleIssueComment(payload, baseCtx);
    expect(runReview).not.toHaveBeenCalled();
  });

  it("passes custom instructions from /review command", async () => {
    const payload = commentPayload("/review focus on SQL injection");
    payload.comment.id = 99; // unique ID to avoid duplicate review lock
    await handleIssueComment(payload, baseCtx);
    expect(runReview).toHaveBeenCalledWith(
      expect.anything(),
      "owner",
      "repo",
      1,
      expect.objectContaining({
        reviewInstructions: "focus on SQL injection",
      })
    );
  });
});
