import crypto from "node:crypto";
import { getDb, nowIso } from "./db";
import { verifyPasswordHash } from "./password";
import { SESSION_DAYS } from "./session-cookie";

/**
 * Single-owner authentication.
 *  - Password is a scrypt hash in OWNER_PASSWORD_HASH, or a plain password in OWNER_PASSWORD
 *    (or typed into OWNER_PASSWORD_HASH). A plain one must be 12+ characters in production.
 *  - Sessions are random 256-bit tokens; only their SHA-256 is stored.
 *  - Every page and API handler checks the session server-side. Middleware is UX only.
 */

export const MIN_PRODUCTION_PASSWORD = 12;

/** A real hash from `npm run hash-password`. Anything else in OWNER_PASSWORD_HASH is a typed password. */
const isScryptHash = (v: string) => /^scrypt\$\d+\$\d+\$\d+\$[^$]+\$[^$]+$/.test(v);

const env = (k: "OWNER_PASSWORD" | "OWNER_PASSWORD_HASH") => process.env[k]?.trim() || undefined;

/**
 * Where the password comes from. People often type their password straight into
 * OWNER_PASSWORD_HASH (it's the variable a host may suggest), so a value there that
 * isn't a scrypt hash is treated as the plain password itself.
 */
function configured(): { hash: string } | { plain: string } | null {
  const h = env("OWNER_PASSWORD_HASH");
  if (h && isScryptHash(h)) return { hash: h };
  const plain = env("OWNER_PASSWORD") ?? h;
  return plain ? { plain } : null;
}

const tooShort = (p: string) => process.env.NODE_ENV === "production" && p.length < MIN_PRODUCTION_PASSWORD;

/** Why sign-in can't work yet, or null when a password is configured. */
export function authProblem(): "missing" | "too_short" | null {
  const c = configured();
  if (!c) return "missing";
  return "plain" in c && tooShort(c.plain) ? "too_short" : null;
}

export function authConfigured(): boolean {
  return authProblem() === null;
}

const sha = (t: string) => crypto.createHash("sha256").update(t).digest();

export async function checkOwnerPassword(password: string): Promise<boolean> {
  if (typeof password !== "string" || password.length === 0 || password.length > 1024) return false;
  const c = configured();
  if (!c) return false;
  if ("hash" in c) return verifyPasswordHash(password, c.hash);
  return !tooShort(c.plain) && crypto.timingSafeEqual(sha(password), sha(c.plain));
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
