# AI Code Reviewer

A self-hosted GitHub bot that automatically reviews your pull requests using Claude. It finds bugs, security issues, and style problems — then posts inline comments just like a human reviewer would.

## What It Does

When you open a PR, the bot:

1. Reacts with 👀 so you know it's working
2. Clones your repo and reads the actual code (not just the diff)
3. Runs 3 AI agents in parallel — bug finder, security auditor, style checker
4. A verification agent double-checks every finding to filter out false positives
5. Posts a review with inline comments on the exact lines that need fixing
6. When you push fixes and the code is clean, it resolves old threads and approves

---

## Setup Guide

You need three things: this repo running on a server, a GitHub App, and a Claude API key.

### Step 1: Get the code

```bash
git clone https://github.com/fantaize/reviewer.git
cd reviewer
npm install
```

### Step 2: Get a Claude API key

Go to [console.anthropic.com](https://console.anthropic.com/) and create an API key. You'll need this in Step 4.

Alternatively, if you have a Claude Code subscription, you can use that instead (see [Authentication](#authentication) below).

### Step 3: Create a GitHub App

This is the part that connects the bot to your repos. Follow these steps exactly:

1. Go to **https://github.com/settings/apps/new**

2. Fill in the basic info:
   - **App name:** Whatever you want (e.g. "My Code Reviewer")
   - **Homepage URL:** `https://github.com` (doesn't matter, just needs a URL)
   - **Webhook URL:** Your server's public URL followed by `/webhook`
     - If you're running locally, use [smee.io](https://smee.io) — click "Start a new channel", copy the URL, and paste it here. You'll proxy it to localhost later.
   - **Webhook secret:** Generate one by running `openssl rand -hex 20` in your terminal. Save this — you'll need it in Step 4.

3. Scroll down to **Permissions**. Set these exactly:

   | Permission | Access |
   |---|---|
   | **Contents** | Read-only |
   | **Pull requests** | Read & write |
   | **Issues** | Read & write |
   | **Checks** | Read & write |

4. Scroll down to **Subscribe to events**. Check these two boxes:
   - [x] Pull request
   - [x] Issue comment

5. Under "Where can this GitHub App be installed?", select **Only on this account**.

6. Click **Create GitHub App**.

7. You'll land on the app settings page. **Copy the App ID** (it's a number near the top).

8. Scroll down to **Private keys** and click **Generate a private key**. A `.pem` file will download. Move it to your project folder:
   ```bash
   mv ~/Downloads/your-app-name.*.private-key.pem ./private-key.pem
   ```

9. Now install the app on your repos. On the same app settings page, click **Install App** in the left sidebar, then click **Install** next to your account. Choose "All repositories" or select specific ones.

### Step 4: Configure

```bash
cp .env.example .env
```

Open `.env` and fill in:

```bash
GITHUB_APP_ID=123456                          # The App ID from Step 3.7
GITHUB_PRIVATE_KEY_PATH=./private-key.pem     # Path to the .pem from Step 3.8
GITHUB_WEBHOOK_SECRET=your_secret_here        # The secret from Step 3.2
ANTHROPIC_API_KEY=sk-ant-...                  # Your API key from Step 2
```

That's it. The defaults for everything else are fine.

### Step 5: Build and run

```bash
npm run build
npm start
```

You should see:
```
[server] AI Code Reviewer listening on port 3000
```

### Step 6: Connect webhooks (if running locally)

If you used smee.io in Step 3, open a second terminal:

```bash
npx smee -u https://smee.io/YOUR_CHANNEL_ID -t http://localhost:3000/webhook
```

### Step 7: Test it

Open a pull request on one of the repos you installed the app on. You should see the 👀 reaction appear within a few seconds, and a review will be posted once the analysis is complete (usually 1-3 minutes).

---

## Deploying to a Server

### Docker (recommended)

```bash
npm run build
docker compose up -d
```

Make sure your `.env` is filled in and `private-key.pem` is in the project root. The Docker Compose file handles mounting the key and reading the env.

Set your GitHub App's webhook URL to `https://your-server.com/webhook`.

### VPS / Bare metal

```bash
npm run build
npm start
```

Use a process manager like `pm2` to keep it running:

```bash
npm install -g pm2
pm2 start dist/index.js --name reviewer
pm2 save
pm2 startup
```

### Port / Reverse proxy

The server listens on port 3000 by default (`PORT` env var). Put nginx or Caddy in front of it for HTTPS:

```nginx
# nginx
server {
    listen 443 ssl;
    server_name reviewer.yourdomain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

```
# Caddyfile
reviewer.yourdomain.com {
    reverse_proxy localhost:3000
}
```

---

## Authentication

The bot needs access to Claude to run reviews. Two options:

### Option A: API Key (recommended)

Set `ANTHROPIC_API_KEY` in your `.env`. No login, no expiry, works everywhere.

### Option B: Claude Code subscription

If you have a Claude Pro/Team subscription with Claude Code:

```bash
npm install -g @anthropic-ai/claude-code
claude setup-token      # generates an auth token
claude auth status      # verify it worked
```

Leave `ANTHROPIC_API_KEY` blank in `.env` and the bot will use your subscription. The token persists across restarts but can expire — the bot will warn you on startup if it does.

For Docker with subscription auth, mount the token directory:
```yaml
volumes:
  - ~/.claude:/root/.claude:ro
```

---

## Configuration

### Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `GITHUB_APP_ID` | Yes | — | Your GitHub App ID |
| `GITHUB_PRIVATE_KEY_PATH` | Yes | — | Path to `.pem` private key |
| `GITHUB_WEBHOOK_SECRET` | Yes | — | Webhook secret for verifying payloads |
| `ANTHROPIC_API_KEY` | Yes* | — | Claude API key (*or use subscription auth) |
| `PORT` | No | `3000` | Server port |
| `CONFIDENCE_THRESHOLD` | No | `80` | Min confidence to post a finding (0-100) |
| `MODEL` | No | `claude-sonnet-4-6` | Model for analysis agents |
| `VERIFIER_MODEL` | No | same as `MODEL` | Model for verification agent |
| `EFFORT` | No | `high` | Reasoning effort: `low` / `medium` / `high` / `max` |
| `ALLOW_MANUAL_REVIEW` | No | `false` | Allow `/review` comments to trigger reviews |

### Per-Repo Rules (optional)

Drop a `REVIEW.md` in any repo's root to customize what the bot looks for:

```markdown
## Rules

1. All API endpoints must validate input with zod
2. Use `logger.error()` instead of `console.error()`
3. No raw SQL — use the query builder

## Ignore Patterns

- docs/**
- **/*.test.ts
- migrations/**

## Custom Instructions

This is a financial services app. Focus on data validation and auth.
```

---

## Usage

**Automatic** — the bot reviews every PR when it's opened, reopened, or updated. No action needed.

**Manual** — set `ALLOW_MANUAL_REVIEW=true`, then comment `/review` on any PR:

```
/review focus on the database migration and check for data loss
```

---

## Cost

Each review runs 3 analysis agents + 1 verification agent. Default config uses Sonnet for analysis and Opus for verification.

| PR Size | Estimated Cost |
|---|---|
| Small (<50 lines) | $1-3 |
| Medium (50-500 lines) | $3-8 |
| Large (500+ lines) | $8-20 |

To reduce costs: use `EFFORT=medium` or set both `MODEL` and `VERIFIER_MODEL` to `claude-sonnet-4-6`.

For max quality: set `MODEL=claude-opus-4-6` with `EFFORT=max`.

---

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
   │  Update check run                   │
   └────────────────┬────────────────────┘
                    │
          (on re-push with 0 findings)
                    │
                    ▼
   ┌─────────────────────────────────────┐
   │  Resolve outdated review threads    │
   │  Approve PR                         │
   └─────────────────────────────────────┘
```

## Troubleshooting

**Bot doesn't react to PRs:**
- Check that the GitHub App is installed on the repo
- Check that your webhook URL is correct and the server is reachable
- Check server logs for incoming webhook events

**"Resource not accessible by integration" error:**
- You're missing a permission. Go to your GitHub App settings and make sure Contents, Pull requests, Issues, and Checks are all set correctly. After changing permissions, you need to accept the new permissions on the installation page.

**Reviews fail with auth errors:**
- If using API key: check that `ANTHROPIC_API_KEY` is set correctly in `.env`
- If using subscription: run `claude auth status` to check. Re-run `claude setup-token` if expired.

**Bot posts no findings on obviously buggy code:**
- Try lowering `CONFIDENCE_THRESHOLD` (default 80). The verifier is aggressive about filtering.
- Try `EFFORT=max` for more thorough analysis.

**Reviews are too expensive:**
- Set `MODEL=claude-sonnet-4-6` and `VERIFIER_MODEL=claude-sonnet-4-6`
- Set `EFFORT=medium`

## Project Structure

```
src/
├── index.ts              # Express server + webhook endpoint
├── webhook.ts            # PR event handlers + dedup
├── review.ts             # Review pipeline + repo cloning
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
