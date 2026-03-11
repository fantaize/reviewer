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
  // Bug: regex doesn't handle special characters in passwords
  const match = connStr.match(
    /^(\w+):\/\/(?:(\w+):(\w+)@)?([^:\/]+):(\d+)\/(.+)$/
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

/**
 * Build a config object from environment variables with defaults.
 */
export function loadConfig() {
  return {
    port: parseInt(process.env.PORT || "3000"),
    host: process.env.HOST || "0.0.0.0",
    logLevel: process.env.LOG_LEVEL || "info",
    // Bug: maxRetries could be NaN if env var is non-numeric
    maxRetries: parseInt(process.env.MAX_RETRIES || "3"),
    timeout: Number(process.env.TIMEOUT) || 30000,
  };
}
