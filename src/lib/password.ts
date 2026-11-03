import crypto from "node:crypto";
import { promisify } from "node:util";

/**
 * scrypt password hashes: `scrypt$N$r$p$salt$key` (base64). No app imports, so
 * scripts/hash-password.ts can run this file directly with Node.
 */
const scrypt = promisify(crypto.scrypt) as (pw: string, salt: Buffer, len: number, opts: crypto.ScryptOptions) => Promise<Buffer>;
const PARAMS = { N: 16384, r: 8, p: 1 };
const KEY_LEN = 64;

export async function hashPassword(password: string, salt = crypto.randomBytes(16)): Promise<string> {
  const key = await scrypt(password, salt, KEY_LEN, PARAMS);
  return ["scrypt", PARAMS.N, PARAMS.r, PARAMS.p, salt.toString("base64"), key.toString("base64")].join("$");
}

export async function verifyPasswordHash(password: string, stored: string): Promise<boolean> {
  const parts = stored.trim().split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, N, r, p, saltB64, keyB64] = parts;
  const expected = Buffer.from(keyB64, "base64");
  const key = await scrypt(password, Buffer.from(saltB64, "base64"), expected.length, { N: Number(N), r: Number(r), p: Number(p) });
  return key.length === expected.length && crypto.timingSafeEqual(key, expected);
}
