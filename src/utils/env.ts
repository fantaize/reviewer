/**
 * Load and validate required environment variables.
 */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

/**
 * Parse a connection string into its components.
 * Uses the URL constructor to correctly handle special characters in credentials.
 */
export function parseConnectionString(connStr: string): {
  host: string;
  port: number;
  database: string;
  user?: string;
  password?: string;
} {
  let url: URL;
  try {
    url = new URL(connStr);
  } catch {
    throw new Error(`Invalid connection string: ${connStr}`);
  }

  if (!url.hostname || !url.port || !url.pathname.slice(1)) {
    throw new Error(`Invalid connection string: ${connStr}`);
  }

  return {
    host: url.hostname,
    port: parseInt(url.port, 10),
    database: url.pathname.slice(1),
    user: url.username || undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
  };
}

function parseIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) {
    throw new Error(`Invalid integer for env var ${name}: "${raw}"`);
  }
  return parsed;
}

/**
 * Build a config object from environment variables with defaults.
 */
export function loadConfig() {
  return {
    port: parseIntEnv("PORT", 3000),
    host: process.env.HOST || "0.0.0.0",
    logLevel: process.env.LOG_LEVEL || "info",
    maxRetries: parseIntEnv("MAX_RETRIES", 3),
    timeout: parseIntEnv("TIMEOUT", 30000),
  };
}
