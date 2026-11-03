import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { destroySession } from "@/lib/auth";
import { publicApi } from "@/lib/guard";
import { SESSION_COOKIE, sessionCookieOptions } from "@/lib/session-cookie";

export const POST = publicApi(async () => {
  destroySession((await cookies()).get(SESSION_COOKIE)?.value);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", sessionCookieOptions(new Date(0)));
  return res;
});
