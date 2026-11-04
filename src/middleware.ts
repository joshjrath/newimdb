import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "./lib/session-cookie";

/**
 * UX only: bounce visitors without a session cookie to /login early.
 * This is NOT the security boundary — every page and API handler validates the
 * session server-side against the database.
 */
export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (req.cookies.get(SESSION_COOKIE)?.value) return NextResponse.next();
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!login|api/auth/login|api/health|api/share/|s/|_next/static|_next/image|favicon.ico|robots.txt).*)"],
};
