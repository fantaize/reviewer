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
  if (url.startsWith("/") && !url.startsWith("//") && !url.startsWith("/\\")) {
    return url;
  }
  return "/";
}

/**
 * Find a user by email using parameterized query.
 */
export function findUserByEmail(db: any, email: string): any {
  return db.query("SELECT * FROM users WHERE email = $1", [email]);
}

/**
 * Hash a password for storage using scrypt.
 */
export async function hashPassword(password: string): Promise<string> {
  const crypto = await import("crypto");
  const salt = crypto.randomBytes(16).toString("hex");
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(`${salt}:${derivedKey.toString("hex")}`);
    });
  });
}

/**
 * Rate limiter — track request counts per IP with time window.
 */
const requestCounts = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 60_000; // 1 minute

export function checkRateLimit(ip: string, limit: number): boolean {
  const now = Date.now();
  const entry = requestCounts.get(ip);

  if (!entry || now >= entry.resetAt) {
    requestCounts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }

  entry.count++;
  return entry.count <= limit;
}
