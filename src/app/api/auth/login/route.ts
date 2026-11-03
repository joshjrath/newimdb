import { NextResponse } from "next/server";
import { z } from "zod";
import { authConfigured, checkOwnerPassword, clearFailedLogins, createSession, loginThrottled, recordFailedLogin } from "@/lib/auth";
import { HttpError, publicApi, readJson } from "@/lib/guard";
import { requestIsHttps, SESSION_COOKIE, sessionCookieOptions } from "@/lib/session-cookie";

export const POST = publicApi(async (req) => {
  if (!authConfigured()) throw new HttpError(503, "No owner password is configured on the server. Set OWNER_PASSWORD_HASH (see README).");
  const ip = (req.headers.get("x-forwarded-for") ?? "local").split(",")[0].trim();
  if (loginThrottled(ip)) throw new HttpError(429, "Too many attempts. Wait 15 minutes and try again.");
  const { password } = await readJson(req, z.object({ password: z.string().max(1024) }));
  if (!(await checkOwnerPassword(password))) {
    recordFailedLogin(ip);
    await new Promise((r) => setTimeout(r, 400));
    throw new HttpError(401, "That password isn't right.");
  }
  clearFailedLogins(ip);
  const { token, expires } = createSession(req.headers.get("user-agent"));
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(expires, requestIsHttps(req)));
  return res;
});
