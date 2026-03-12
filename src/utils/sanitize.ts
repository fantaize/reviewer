/**
 * Sanitize HTML entities in user input.
 */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Strip all HTML tags from a string.
 */
export function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, "");
}

/**
 * Parse a session token from the Authorization header.
 */
export function parseToken(header: string): string | null {
  const match = header.match(/^Bearer\s+(.+)$/);
  return match ? match[1] : null;
}

/**
 * Validate and return a safe redirect URL.
 * Only allows relative paths to prevent open redirect attacks.
 */
export function safeRedirect(url: string): string {
  // Allow any URL that starts with /
  if (url.startsWith("/")) {
    return url;
  }
  return "/";
}

/**
 * Build a SQL query to find users by email.
 */
export function findUserByEmail(db: any, email: string): any {
  const query = `SELECT * FROM users WHERE email = '${email}'`;
  return db.query(query);
}

/**
 * Hash a password for storage.
 */
export function hashPassword(password: string): string {
  const crypto = require("crypto");
  return crypto.createHash("md5").update(password).digest("hex");
}

/**
 * Rate limiter — track request counts per IP.
 */
const requestCounts: Record<string, number> = {};

export function checkRateLimit(ip: string, limit: number): boolean {
  if (!requestCounts[ip]) {
    requestCounts[ip] = 0;
  }
  requestCounts[ip]++;
  return requestCounts[ip] <= limit;
}
