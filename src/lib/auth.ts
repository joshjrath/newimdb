import crypto from "node:crypto";
import { getDb, nowIso } from "./db";
import { verifyPasswordHash } from "./password";
import { SESSION_DAYS } from "./session-cookie";

/**
 * Single-owner authentication.
 *  - Password is verified against OWNER_PASSWORD_HASH (scrypt) when set, otherwise OWNER_PASSWORD
 *    (a plain secret in the host's variables, e.g. Railway). In production it must be 12+ characters.
 *  - Sessions are random 256-bit tokens; only their SHA-256 is stored.
 *  - Every page and API handler checks the session server-side. Middleware is UX only.
 */

export const MIN_PRODUCTION_PASSWORD = 12;

/** The plain password, if one is set and long enough for where it's running. */
const plainPassword = () => {
  const p = process.env.OWNER_PASSWORD?.trim();
  if (!p) return undefined;
  return process.env.NODE_ENV === "production" && p.length < MIN_PRODUCTION_PASSWORD ? undefined : p;
};

/** Why sign-in can't work yet, or null when a password is configured. */
export function authProblem(): "missing" | "too_short" | null {
  if (process.env.OWNER_PASSWORD_HASH || plainPassword()) return null;
  return process.env.OWNER_PASSWORD?.trim() ? "too_short" : "missing";
}

export function authConfigured(): boolean {
  return authProblem() === null;
}

const sha = (t: string) => crypto.createHash("sha256").update(t).digest();

export async function checkOwnerPassword(password: string): Promise<boolean> {
  if (typeof password !== "string" || password.length === 0 || password.length > 1024) return false;
  const hash = process.env.OWNER_PASSWORD_HASH;
  if (hash) return verifyPasswordHash(password, hash);
  const plain = plainPassword();
  return Boolean(plain) && crypto.timingSafeEqual(sha(password), sha(plain!));
}

const tokenHash = (t: string) => sha(t).toString("hex");

export function createSession(userAgent?: string | null): { token: string; expires: Date } {
  const token = crypto.randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000);
  const db = getDb();
  db.prepare(`DELETE FROM session WHERE expires_at < ?`).run(nowIso());
  db.prepare(`INSERT INTO session (token_hash, created_at, expires_at, user_agent) VALUES (?,?,?,?)`).run(
    tokenHash(token),
    nowIso(),
    expires.toISOString(),
    userAgent?.slice(0, 200) ?? null,
  );
  return { token, expires };
}

export function validateSession(token: string | undefined | null): boolean {
  if (!token || token.length > 200 || !authConfigured()) return false;
  const row = getDb().prepare(`SELECT expires_at FROM session WHERE token_hash = ?`).get(tokenHash(token)) as { expires_at: string } | undefined;
  return Boolean(row && row.expires_at > nowIso());
}

export function destroySession(token: string | undefined | null) {
  if (token) getDb().prepare(`DELETE FROM session WHERE token_hash = ?`).run(tokenHash(token));
}

/* ---- in-memory login throttling (per process) ---- */

const attempts = new Map<string, { count: number; first: number }>();
const WINDOW = 15 * 60_000;
const MAX = 8;

function sweepAttempts(now: number) {
  for (const [k, a] of attempts) if (now - a.first > WINDOW) attempts.delete(k);
}

export function loginThrottled(key: string): boolean {
  sweepAttempts(Date.now());
  return (attempts.get(key)?.count ?? 0) >= MAX;
}

export function recordFailedLogin(key: string) {
  const a = attempts.get(key);
  if (a) a.count++;
  else attempts.set(key, { count: 1, first: Date.now() });
}

export function clearFailedLogins(key: string) {
  attempts.delete(key);
}
