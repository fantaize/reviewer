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
 */
export function parseConnectionString(connStr: string): {
  host: string;
  port: number;
  database: string;
  user?: string;
  password?: string;
} {
  const match = connStr.match(
    /^(\w+):\/\/(?:([^:]+):([^@]+)@)?([^:\/]+):(\d+)\/(.+)$/
  );
  if (!match) {
    throw new Error(`Invalid connection string: ${connStr}`);
  }

  return {
    host: match[4],
    port: parseInt(match[5]),
    database: match[6],
    user: match[2],
    password: match[3],
  };
}

function parseIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = parseInt(raw, 10);
  if (isNaN(parsed)) throw new Error(`Invalid integer for env var ${name}: "${raw}"`);
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
