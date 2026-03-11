#!/usr/bin/env bash
set -euo pipefail

# AI Code Reviewer — Setup Script
# Creates the .env file with guided prompts

echo ""
echo "  AI Code Reviewer — Setup"
echo "  ========================"
echo ""

if [ -f .env ]; then
  read -rp "  .env already exists. Overwrite? (y/N) " overwrite
  if [[ ! "$overwrite" =~ ^[Yy]$ ]]; then
    echo "  Aborted."
    exit 0
  fi
fi

echo "  Before running this script, you need a GitHub App."
echo "  If you haven't created one yet, go to:"
echo ""
echo "    https://github.com/settings/apps/new"
echo ""
echo "  Required settings:"
echo "    - Webhook URL: your server's public URL + /webhook"
echo "    - Webhook secret: a random string (this script will generate one)"
echo "    - Permissions: Contents (read), Pull Requests (read+write), Issues (read+write)"
echo "    - Events: Pull request, Issue comment"
echo ""

# Generate webhook secret
WEBHOOK_SECRET=$(openssl rand -hex 20)
echo "  Generated webhook secret: $WEBHOOK_SECRET"
echo "  (Set this as your GitHub App's webhook secret)"
echo ""

read -rp "  GitHub App ID: " APP_ID
read -rp "  Path to private key (.pem file): " KEY_PATH

# Expand ~ in path
KEY_PATH="${KEY_PATH/#\~/$HOME}"

if [ ! -f "$KEY_PATH" ]; then
  echo "  WARNING: File not found at $KEY_PATH"
  echo "  You can fix this in .env later."
fi

read -rp "  Port (default 3000): " PORT
PORT=${PORT:-3000}

read -rp "  Model (default claude-opus-4-6): " MODEL
MODEL=${MODEL:-claude-opus-4-6}

read -rp "  Effort - low/medium/high/max (default max): " EFFORT
EFFORT=${EFFORT:-max}

read -rp "  Confidence threshold 0-100 (default 80): " THRESHOLD
THRESHOLD=${THRESHOLD:-80}

read -rp "  Anthropic API key (leave blank to use Claude Code subscription): " API_KEY

cat > .env <<EOF
GITHUB_APP_ID=${APP_ID}
GITHUB_PRIVATE_KEY_PATH=${KEY_PATH}
GITHUB_WEBHOOK_SECRET=${WEBHOOK_SECRET}
PORT=${PORT}
CONFIDENCE_THRESHOLD=${THRESHOLD}

# Model settings
MODEL=${MODEL}
EFFORT=${EFFORT}

# Optional: Anthropic API key (overrides Claude Code subscription auth)
ANTHROPIC_API_KEY=${API_KEY}
EOF

echo ""
echo "  .env created successfully!"
echo ""
echo "  Next steps:"
echo "    1. Set the webhook secret in your GitHub App settings to:"
echo "       $WEBHOOK_SECRET"
echo "    2. Install the app on your repos at:"
echo "       https://github.com/settings/apps → your app → Install"
echo "    3. Start the server:"
echo "       npm run dev"
echo "    4. Expose your local server (for development):"
echo "       npx smee -u https://smee.io/new -t http://localhost:${PORT}/webhook"
echo ""
