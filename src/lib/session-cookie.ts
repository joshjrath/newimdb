/**
 * Session cookie name and options. Dependency-free so the edge middleware,
 * the auth module and the route handlers all share one definition.
 */
export const SESSION_COOKIE = "sw_session";
export const SESSION_DAYS = 30;

/**
 * Secure cookies are only kept by browsers over https, so the flag follows the request:
 * https (directly or behind a proxy that says so) → Secure. COOKIE_SECURE=true/false forces it.
 * Before, a production build opened over plain http silently dropped the cookie and bounced
 * every sign-in back to the login page.
 */
export function requestIsHttps(req: Request): boolean {
  const forced = process.env.COOKIE_SECURE;
  if (forced === "true") return true;
  if (forced === "false") return false;
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0].trim();
  return (proto ?? new URL(req.url).protocol.replace(":", "")) === "https";
}

export function sessionCookieOptions(expires: Date, secure: boolean) {
  return { httpOnly: true, secure, sameSite: "lax" as const, path: "/", expires };
}
