import { NextResponse } from "next/server";
import { z } from "zod";
import {
  authConfigured, checkOwnerPassword, clearFailedLogins, cookieSecure, createSession, loginThrottled,
  recordFailedLogin, SESSION_COOKIE,
} from "@/lib/auth";
import { errorResponse, HttpError } from "@/lib/guard";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const origin = req.headers.get("origin");
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    if (origin && new URL(origin).host !== host) throw new HttpError(403, "Cross-origin request refused.");
    if (!authConfigured()) throw new HttpError(503, "No owner password is configured on the server. Set OWNER_PASSWORD_HASH (see README).");
    const ip = (req.headers.get("x-forwarded-for") ?? "local").split(",")[0].trim();
    if (loginThrottled(ip)) throw new HttpError(429, "Too many attempts. Wait 15 minutes and try again.");
    const { password } = z.object({ password: z.string().max(1024) }).parse(await req.json());
    if (!checkOwnerPassword(password)) {
      recordFailedLogin(ip);
      await new Promise((r) => setTimeout(r, 400));
      throw new HttpError(401, "That password isn't right.");
    }
    clearFailedLogins(ip);
    const { token, expires } = createSession(req.headers.get("user-agent"));
    const res = NextResponse.json({ ok: true });
    res.cookies.set(SESSION_COOKIE, token, { httpOnly: true, secure: cookieSecure(), sameSite: "lax", path: "/", expires });
    res.headers.set("Cache-Control", "no-store");
    return res;
  } catch (e) {
    return errorResponse(e);
  }
}
