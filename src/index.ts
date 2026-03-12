// Must unset CLAUDECODE before any imports to prevent "nested session" errors
// when spawning Claude Agent SDK subprocesses
delete process.env.CLAUDECODE;

import "dotenv/config";
import express from "express";
import crypto from "node:crypto";
import fs from "node:fs";
import { execSync } from "node:child_process";
import {
  handlePullRequest,
  handleIssueComment,
  type PullRequestPayload,
  type IssueCommentPayload,
  type ReviewMode,
} from "./webhook.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const PORT = parseInt(process.env.PORT ?? "3000", 10);
const WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET ?? "";
const APP_ID = process.env.GITHUB_APP_ID ?? "";
const PRIVATE_KEY_PATH = process.env.GITHUB_PRIVATE_KEY_PATH ?? "";
const CONFIDENCE_THRESHOLD = parseInt(
  process.env.CONFIDENCE_THRESHOLD ?? "80",
  10
);

const MODEL = process.env.MODEL ?? "claude-opus-4-6";
const VERIFIER_MODEL = process.env.VERIFIER_MODEL || undefined;
const EFFORT = (process.env.EFFORT ?? "max") as "low" | "medium" | "high" | "max";
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || undefined;
const REVIEW_MODE = (process.env.REVIEW_MODE ?? "once") as ReviewMode;

// ---------------------------------------------------------------------------
// Startup validation
// ---------------------------------------------------------------------------
const errors: string[] = [];
if (!APP_ID) errors.push("GITHUB_APP_ID is required");
if (!PRIVATE_KEY_PATH) errors.push("GITHUB_PRIVATE_KEY_PATH is required");
if (PRIVATE_KEY_PATH && !fs.existsSync(PRIVATE_KEY_PATH)) {
  errors.push(`Private key file not found: ${PRIVATE_KEY_PATH}`);
}
if (!WEBHOOK_SECRET) {
  console.warn("[startup] WARNING: GITHUB_WEBHOOK_SECRET is not set — webhook signatures will not be verified");
}
if (!["low", "medium", "high", "max"].includes(EFFORT)) {
  errors.push(`Invalid EFFORT value: ${EFFORT} (must be low, medium, high, or max)`);
}
if (!["once", "every_push", "manual"].includes(REVIEW_MODE)) {
  errors.push(`Invalid REVIEW_MODE value: ${REVIEW_MODE} (must be once, every_push, or manual)`);
}
if (errors.length > 0) {
  console.error("\n  Configuration errors:\n");
  for (const err of errors) {
    console.error(`    - ${err}`);
  }
  console.error("\n  See .env.example for required variables.\n");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------
const app = express();

// Raw body for webhook signature verification
app.use(
  "/webhook",
  express.raw({ type: "application/json" })
);

// Health check
app.get("/", (_req, res) => {
  res.json({ status: "ok", service: "ai-code-reviewer" });
});

// Webhook endpoint
app.post("/webhook", (req, res) => {
  // Verify webhook signature
  if (WEBHOOK_SECRET) {
    const signature = req.headers["x-hub-signature-256"] as string | undefined;
    if (!signature) {
      res.status(401).json({ error: "Missing signature" });
      return;
    }

    const body = req.body as Buffer;
    const expected =
      "sha256=" +
      crypto.createHmac("sha256", WEBHOOK_SECRET).update(body).digest("hex");

    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
      res.status(401).json({ error: "Invalid signature" });
      return;
    }
  }

  const event = req.headers["x-github-event"] as string;
  const payload = JSON.parse((req.body as Buffer).toString());

  // Respond immediately, process async
  res.status(200).json({ received: true });

  const ctx = {
    appConfig: { appId: APP_ID, privateKeyPath: PRIVATE_KEY_PATH },
    reviewOptions: {
      confidenceThreshold: CONFIDENCE_THRESHOLD,
      modelConfig: { model: MODEL, effort: EFFORT, apiKey: ANTHROPIC_API_KEY, verifierModel: VERIFIER_MODEL },
    },
    reviewMode: REVIEW_MODE,
  };

  // Route events
  if (event === "pull_request") {
    handlePullRequest(payload as PullRequestPayload, ctx).catch((err) =>
      console.error("[server] Unhandled error in PR handler:", err)
    );
  } else if (event === "issue_comment") {
    handleIssueComment(payload as IssueCommentPayload, ctx).catch((err) =>
      console.error("[server] Unhandled error in comment handler:", err)
    );
  }
});

app.listen(PORT, () => {
  console.log("");
  console.log("  AI Code Reviewer");
  console.log(`  Model: ${MODEL} | Verifier: ${VERIFIER_MODEL ?? MODEL} | Effort: ${EFFORT} | Confidence threshold: ${CONFIDENCE_THRESHOLD}`);
  console.log(`  Review mode: ${REVIEW_MODE}`);
  console.log(`  Webhook:  POST http://localhost:${PORT}/webhook`);
  console.log(`  Health:   GET  http://localhost:${PORT}/`);

  // Check Claude auth status on startup
  if (!ANTHROPIC_API_KEY) {
    try {
      const status = execSync("claude auth status --text", { stdio: "pipe", timeout: 10_000 }).toString();
      if (/logged in/i.test(status)) {
        console.log("  Auth:     Claude Code (logged in)");
      } else {
        console.warn("");
        console.warn("  WARNING: Claude Code is not authenticated.");
        console.warn('  Run "claude setup-token" to authenticate, or set ANTHROPIC_API_KEY in .env');
      }
    } catch {
      console.warn("");
      console.warn("  WARNING: Could not check Claude Code auth status.");
      console.warn('  Run "claude setup-token" to authenticate, or set ANTHROPIC_API_KEY in .env');
    }
  } else {
    console.log("  Auth:     API key");
  }

  console.log("");
});
