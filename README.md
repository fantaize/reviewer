# AI Code Reviewer

A self-hosted GitHub bot that performs multi-agent AI code reviews on pull requests using Claude. Inspired by Anthropic's Code Review feature.

**How it works:** When a PR is opened, the bot clones the repo and dispatches a team of specialized AI agents in parallel — a bug finder, a security auditor, and a style checker. A verification agent then cross-examines every finding against the actual codebase to filter false positives. Only high-confidence issues are posted as inline review comments.

## Features

- **Multi-agent architecture** — Parallel bug, security, and style analysis agents
- **Full codebase exploration** — Agents use Read/Grep/Glob to explore beyond the diff
- **Adversarial verification** — A verifier agent tries to _disprove_ every finding before it's posted
- **Configurable per-repo** — Drop a `REVIEW.md` in your repo root with custom rules
- **Manual trigger** — Comment `/review` on any PR to trigger a review (opt-in via env)
- **GitHub Check Runs** — CI-friendly status checks on every review
- **Thread resolution** — Automatically resolves outdated review threads on clean re-reviews
- **Structured output** — Prose summary above the fold, structured analysis in collapsible details

## Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated (`npm install -g @anthropic-ai/claude-code`)
- A GitHub account to create a GitHub App

### 1. Clone and install

```bash
git clone https://github.com/fantaize/reviewer.git
cd reviewer
npm install
```

### 2. Create a GitHub App

Go to **[github.com/settings/apps/new](https://github.com/settings/apps/new)** and configure:

| Setting | Value |
|---|---|
| **App name** | Your choice (e.g. "AI Code Reviewer") |
| **Homepage URL** | Any URL |
| **Webhook URL** | Your server URL + `/webhook` (use [smee.io](https://smee.io) for local dev) |
| **Webhook secret** | A random string (the setup script generates one) |

**Permissions:**

| Permission | Access |
|---|---|
| Contents | Read |
| Pull requests | Read & Write |
| Issues | Read & Write |
| Checks | Read & Write |

**Subscribe to events:**
- Pull request
- Issue comment

After creating the app:
1. Note the **App ID** from the app settings page
2. Generate a **private key** (.pem file) and save it to the project directory
3. **Install the app** on the repos you want reviewed

### 3. Configure

Run the interactive setup:

```bash
npm run setup
```

Or manually copy `.env.example` to `.env` and fill in the values.

### 4. Start the server

**Development** (auto-reload):
```bash
npm run dev
```

**Production**:
```bash
npm run build
npm start
```

**Docker**:
```bash
# Place your private-key.pem in the project root
npm run build
docker compose up -d
```

### 5. Expose your webhook (local development)

For local development, use [smee.io](https://smee.io) to forward GitHub webhooks to your machine:

```bash
npx smee -u https://smee.io/YOUR_CHANNEL -t http://localhost:3000/webhook
```

Set the smee.io URL as your GitHub App's webhook URL.

## Authentication

The bot needs access to Claude. Two options:

### Option A: API Key (recommended for servers)

Set `ANTHROPIC_API_KEY` in your `.env`. This uses the Anthropic API directly — no interactive login needed. Most reliable for unattended VPS/server deployments.

### Option B: Claude Code Subscription

Uses your existing Claude Code subscription. Requires a one-time token setup:

```bash
# Install Claude Code CLI
npm install -g @anthropic-ai/claude-code

# Generate an auth token (works on headless servers/VPS)
claude setup-token

# Verify it worked
claude auth status --text
```

The token is stored in `~/.claude/` and persists across restarts. The bot checks auth status on startup and will warn you if re-authentication is needed. If a review fails due to an expired token, the error message will tell you to run `claude setup-token` again.

For Docker deployments using OAuth, mount the auth directory:

```yaml
# docker-compose.yml
volumes:
  - ~/.claude:/root/.claude:ro
```

## Configuration

### Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `GITHUB_APP_ID` | Yes | — | Your GitHub App's ID |
| `GITHUB_PRIVATE_KEY_PATH` | Yes | — | Path to your `.pem` private key |
| `GITHUB_WEBHOOK_SECRET` | Recommended | — | Webhook signature secret |
| `PORT` | No | `3000` | Server port |
| `CONFIDENCE_THRESHOLD` | No | `80` | Minimum confidence (0-100) to post a finding |
| `MODEL` | No | `claude-sonnet-4-6` | Claude model for analysis agents |
| `VERIFIER_MODEL` | No | Same as `MODEL` | Claude model for the verification agent |
| `EFFORT` | No | `high` | Reasoning effort: `low`, `medium`, `high`, `max` |
| `ALLOW_MANUAL_REVIEW` | No | `false` | Enable `/review` comment command |
| `ANTHROPIC_API_KEY` | No | — | API key (overrides Claude Code subscription) |

### Per-Repo Configuration (REVIEW.md)

Add a `REVIEW.md` file to your repo root to customize reviews:

```markdown
## Rules

1. All API endpoints must validate request body with zod schemas
2. Use `logger.error()` instead of `console.error()`
3. Database queries must use parameterized statements

## Ignore Patterns

- docs/**
- **/*.test.ts
- migrations/**

## Custom Instructions

Focus on API security and data validation. This is a financial services application.
```

## How It Works

```
PR Opened/Updated
        │
        ▼
   ┌─────────┐
   │ Webhook  │──── Verify signature, skip drafts, dedup
   └────┬────┘
        │
        ▼
   👀 React with eyes + Create check run
        │
        ▼
   ┌─────────┐
   │  Clone   │──── Shallow clone at PR head SHA
   └────┬────┘
        │
        ▼
   ┌─────────────────────────────────────┐
   │        Parallel Analysis            │
   │  ┌───────┐ ┌──────────┐ ┌───────┐  │
   │  │ Bugs  │ │ Security │ │ Style │  │
   │  └───┬───┘ └────┬─────┘ └───┬───┘  │
   └──────┼──────────┼───────────┼──────┘
          │          │           │
          ▼          ▼           ▼
   ┌─────────────────────────────────────┐
   │       Deduplicate Findings          │
   └────────────────┬────────────────────┘
                    │
                    ▼
   ┌─────────────────────────────────────┐
   │     Adversarial Verification        │
   │  "Try to DISPROVE each finding"     │
   └────────────────┬────────────────────┘
                    │
                    ▼
   ┌─────────────────────────────────────┐
   │  Filter by confidence threshold     │
   │  Rank: severity → confidence        │
   └────────────────┬────────────────────┘
                    │
                    ▼
   ┌─────────────────────────────────────┐
   │  Post review body + inline comments │
   │  Update check run ✓                 │
   └────────────────┬────────────────────┘
                    │
          (on re-push with 0 findings)
                    │
                    ▼
   ┌─────────────────────────────────────┐
   │  Resolve outdated review threads    │
   │  Approve PR ✓                       │
   └─────────────────────────────────────┘
```

## Usage

**Automatic:** The bot reviews every PR automatically when opened, updated, or reopened.

**Manual:** Set `ALLOW_MANUAL_REVIEW=true` in `.env`, then comment `/review` on any PR to trigger a review. You can add custom instructions:

```
/review Focus on the database migration changes and check for data loss
```

## Cost Expectations

This bot uses Claude with multi-turn tool use across multiple agents. The default config uses Sonnet for analysis and Opus for verification. Each agent explores the codebase with Read/Grep/Glob tools for ~20 turns. Expect roughly:

| PR Size | Agents | Estimated Cost (default config) |
|---|---|---|
| Small (<50 lines) | 2 | $1-3 |
| Medium (50-500 lines) | 3 | $3-8 |
| Large (500+ lines) | 3 | $8-20 |

Costs depend on model choice and reasoning effort. To reduce costs, use `EFFORT=medium` or set `VERIFIER_MODEL` to the same as `MODEL`. For maximum quality, use `MODEL=claude-opus-4-6` with `EFFORT=max`.

## Project Structure

```
src/
├── index.ts              # Express server + webhook endpoint
├── webhook.ts            # PR event handlers + dedup
├── review.ts             # Top-level review pipeline + repo cloning
├── github.ts             # GitHub App auth + API helpers
├── diff.ts               # Unified diff parser
├── config.ts             # REVIEW.md loader
├── formatter.ts          # Findings → GitHub review comments
└── agents/
    ├── types.ts           # Shared types
    ├── runner.ts          # Claude Agent SDK wrapper
    ├── bug-finder.ts      # Bug detection agent
    ├── security.ts        # Security audit agent
    ├── style.ts           # Style/convention checker
    ├── verifier.ts        # Adversarial verification agent
    └── orchestrator.ts    # Parallel dispatch + dedup + rank
```

## License

MIT
