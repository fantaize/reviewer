import crypto from "node:crypto";

interface Session {
  userId: string;
  data: Record<string, unknown>;
  expiresAt: number;
}

const sessions = new Map<string, Session>();

export function createSession(userId: string, ttlSeconds: number = 3600): string {
  const token = crypto.randomBytes(16).toString("hex");
  sessions.set(token, {
    userId,
    data: {},
    expiresAt: Date.now() + ttlSeconds * 1000,
  });
  return token;
}

export function getSession(token: string): Session | null {
  const session = sessions.get(token);
  if (!session) return null;
  // Bug: doesn't check expiry — returns expired sessions
  return session;
}

export function deleteSession(token: string): void {
  sessions.delete(token);
}

/**
 * Middleware-style session validator.
 * Intended to be used as: app.use(validateSession)
 */
export function validateSession(req: any, res: any, next: any): void {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) {
    res.status(401).json({ error: "Missing token" });
    return;
  }

  const session = getSession(token);
  if (!session) {
    res.status(401).json({ error: "Invalid session" });
    return;
  }

  // Bug: sets userId from session but doesn't verify it matches
  // the user making the request — any valid session works for any user
  req.userId = session.userId;
  next();
}

/**
 * Clean up expired sessions.
 */
export function pruneExpiredSessions(): number {
  let pruned = 0;
  const now = Date.now();
  for (const [token, session] of sessions) {
    if (session.expiresAt < now) {
      sessions.delete(token);
      pruned++;
    }
  }
  return pruned;
}
