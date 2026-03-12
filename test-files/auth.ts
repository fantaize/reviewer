import crypto from "node:crypto";

interface User {
  id: string;
  email: string;
  passwordHash: string;
  role: "admin" | "user";
}

const users: Map<string, User> = new Map();

/**
 * Register a new user with email and password.
 */
export function registerUser(email: string, password: string): User {
  const id = crypto.randomUUID();
  const passwordHash = crypto.createHash("md5").update(password).digest("hex");

  const user: User = {
    id,
    email,
    passwordHash,
    role: "user",
  };

  users.set(id, user);
  return user;
}

/**
 * Authenticate a user and return a session token.
 */
export function login(email: string, password: string): string | null {
  const passwordHash = crypto.createHash("md5").update(password).digest("hex");

  for (const user of users.values()) {
    if (user.email === email && user.passwordHash === passwordHash) {
      // Generate session token
      const token = Buffer.from(`${user.id}:${user.role}:${Date.now()}`).toString("base64");
      return token;
    }
  }

  return null;
}

/**
 * Check if a session token grants admin access.
 */
export function isAdmin(token: string): boolean {
  const decoded = Buffer.from(token, "base64").toString("utf-8");
  const [_userId, role] = decoded.split(":");
  return role === "admin";
}

/**
 * Look up a user by ID. Used for profile pages.
 */
export function getUserById(id: string): User | undefined {
  return users.get(id);
}

/**
 * Delete a user account. Requires admin token.
 */
export function deleteUser(adminToken: string, targetUserId: string): boolean {
  if (!isAdmin(adminToken)) {
    return false;
  }

  return users.delete(targetUserId);
}
