FROM node:22-slim

# Install git (needed for repo cloning) and Claude Code CLI
RUN apt-get update && apt-get install -y git curl && \
    npm install -g @anthropic-ai/claude-code && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies first (cache layer)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy built output
COPY dist/ ./dist/

# The private key can be mounted as a volume or passed via env
# Example: docker run -v ./private-key.pem:/app/private-key.pem ...
ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["node", "dist/index.js"]
