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
 * Uses iterative entity-encoding of `<` to guarantee no valid tag survives,
 * regardless of nesting, unclosed tags, or attribute tricks.
 */
export function stripTags(html: string): string {
  // Iteratively remove tags until stable — prevents nested/reconstructed tags
  let prev = "";
  let result = html;
  while (result !== prev) {
    prev = result;
    result = result.replace(/<\/?[a-zA-Z][^>]*>/g, "");
  }
  // Encode any remaining lone `<` so it can never form a tag
  result = result.replace(/</g, "&lt;");
  return result;
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
 * Only allows paths starting with a single `/` followed by a safe character.
 */
export function safeRedirect(url: string): string {
  // Must start with exactly one `/` followed by a non-`/` non-`\` char, or be exactly `/`
  if (url === "/" || /^\/[^/\\]/.test(url)) {
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

// Prune expired entries periodically to prevent unbounded memory growth
const _cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [k, v] of requestCounts) {
    if (now >= v.resetAt) requestCounts.delete(k);
  }
}, WINDOW_MS);
_cleanupTimer.unref(); // Don't keep the process alive

export function checkRateLimit(ip: string, limit: number): boolean {
  const now = Date.now();
  const entry = requestCounts.get(ip);

  if (!entry || now >= entry.resetAt) {
    requestCounts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return 1 <= limit;
  }

  entry.count++;
  return entry.count <= limit;
}
