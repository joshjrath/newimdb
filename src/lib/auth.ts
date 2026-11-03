import crypto from "node:crypto";
import { getDb, nowIso } from "./db";

/**
 * Single-owner authentication.
 *  - Password is verified against OWNER_PASSWORD_HASH (scrypt), or OWNER_PASSWORD in non-production.
 *  - Sessions are random 256-bit tokens; only their SHA-256 is stored.
 *  - Every page and API handler calls an owner check server-side. Middleware is UX only.
 */

export const SESSION_COOKIE = "sw_session";
const SESSION_DAYS = 30;

export function hashPassword(password: string, salt = crypto.randomBytes(16)): string {
  const N = 16384, r = 8, p = 1;
  const key = crypto.scryptSync(password, salt, 64, { N, r, p });
  return `scrypt$${N}$${r}$${p}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export function verifyPasswordHash(password: string, stored: string): boolean {
  const parts = stored.trim().split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, N, r, p, saltB64, keyB64] = parts;
  const expected = Buffer.from(keyB64, "base64");
  const key = crypto.scryptSync(password, Buffer.from(saltB64, "base64"), expected.length, {
    N: Number(N),
    r: Number(r),
    p: Number(p),
  });
  return key.length === expected.length && crypto.timingSafeEqual(key, expected);
}

export function authConfigured(): boolean {
  return Boolean(process.env.OWNER_PASSWORD_HASH || (process.env.NODE_ENV !== "production" && process.env.OWNER_PASSWORD));
}

export function checkOwnerPassword(password: string): boolean {
  if (typeof password !== "string" || password.length === 0 || password.length > 1024) return false;
  const hash = process.env.OWNER_PASSWORD_HASH;
  if (hash) return verifyPasswordHash(password, hash);
  const plain = process.env.NODE_ENV !== "production" ? process.env.OWNER_PASSWORD : undefined;
  if (!plain) return false;
  const a = crypto.createHash("sha256").update(password).digest();
  const b = crypto.createHash("sha256").update(plain).digest();
  return crypto.timingSafeEqual(a, b);
}

const sha = (t: string) => crypto.createHash("sha256").update(t).digest("hex");

export function createSession(userAgent?: string | null): { token: string; expires: Date } {
  const token = crypto.randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000);
  const db = getDb();
  db.prepare(`DELETE FROM session WHERE expires_at < ?`).run(nowIso());
  db.prepare(`INSERT INTO session (token_hash, created_at, expires_at, user_agent) VALUES (?,?,?,?)`).run(
    sha(token),
    nowIso(),
    expires.toISOString(),
    userAgent?.slice(0, 200) ?? null,
  );
  return { token, expires };
}

export function validateSession(token: string | undefined | null): boolean {
  if (!token || token.length > 200) return false;
  if (!authConfigured()) return false;
  const row = getDb().prepare(`SELECT expires_at FROM session WHERE token_hash = ?`).get(sha(token)) as
    | { expires_at: string }
    | undefined;
  return Boolean(row && row.expires_at > nowIso());
}

export function destroySession(token: string | undefined | null) {
  if (token) getDb().prepare(`DELETE FROM session WHERE token_hash = ?`).run(sha(token));
}

export function destroyAllSessions() {
  getDb().prepare(`DELETE FROM session`).run();
}

export function cookieSecure(): boolean {
  if (process.env.COOKIE_SECURE === "false") return false;
  return process.env.NODE_ENV === "production";
}

// --- naive in-memory login throttling (per process) ---
const attempts = new Map<string, { count: number; first: number }>();
const WINDOW = 15 * 60_000;
const MAX = 8;

export function loginThrottled(key: string): boolean {
  const a = attempts.get(key);
  if (!a) return false;
  if (Date.now() - a.first > WINDOW) {
    attempts.delete(key);
    return false;
  }
  return a.count >= MAX;
}
export function recordFailedLogin(key: string) {
  const a = attempts.get(key);
  if (!a || Date.now() - a.first > WINDOW) attempts.set(key, { count: 1, first: Date.now() });
  else a.count++;
}
export function clearFailedLogins(key: string) {
  attempts.delete(key);
}
