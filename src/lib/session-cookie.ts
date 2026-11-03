/**
 * Session cookie name and options. Dependency-free so the edge middleware,
 * the auth module and the route handlers all share one definition.
 */
export const SESSION_COOKIE = "sw_session";
export const SESSION_DAYS = 30;

export function sessionCookieOptions(expires: Date) {
  const secure = process.env.COOKIE_SECURE !== "false" && process.env.NODE_ENV === "production";
  return { httpOnly: true, secure, sameSite: "lax" as const, path: "/", expires };
}
