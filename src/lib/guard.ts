import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { SESSION_COOKIE, validateSession } from "./auth";
import { RepoError } from "./repo/media";
import { ProviderError } from "./providers/http";

/** Server Components / pages: redirect to login unless the owner is signed in. */
export async function requireOwnerPage(nextPath?: string): Promise<void> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!validateSession(token)) {
    redirect(`/login${nextPath ? `?next=${encodeURIComponent(nextPath)}` : ""}`);
  }
}

/** Non-redirecting check, e.g. for generateMetadata, so titles never leak to a signed-out request. */
export async function isOwner(): Promise<boolean> {
  return validateSession((await cookies()).get(SESSION_COOKIE)?.value);
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public extra?: Record<string, unknown>,
  ) {
    super(message);
  }
}

async function assertOwnerRequest(req: Request) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!validateSession(token)) throw new HttpError(401, "Sign in required.");
  const method = req.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    // CSRF defence: same-origin only, on top of the SameSite cookie.
    const origin = req.headers.get("origin");
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host");
    if (origin) {
      let ok = false;
      try {
        ok = new URL(origin).host === host;
      } catch {}
      if (!ok) throw new HttpError(403, "Cross-origin request refused.");
    } else if (h.get("sec-fetch-site") && h.get("sec-fetch-site") !== "same-origin") {
      throw new HttpError(403, "Cross-site request refused.");
    }
  }
}

type Handler<C> = (req: Request, ctx: C) => Promise<Response | unknown>;

/** Wrap every API route: owner check first, consistent JSON errors, never cached. */
export function ownerApi<C = unknown>(fn: Handler<C>) {
  return async (req: Request, ctx: C): Promise<Response> => {
    try {
      await assertOwnerRequest(req);
      const out = await fn(req, ctx);
      const res = out instanceof Response ? out : NextResponse.json(out ?? { ok: true });
      if (!res.headers.has("Cache-Control")) res.headers.set("Cache-Control", "private, no-store");
      return res;
    } catch (err) {
      return errorResponse(err);
    }
  };
}

export function errorResponse(err: unknown): Response {
  if (err instanceof HttpError) {
    return NextResponse.json({ error: err.message, ...err.extra }, { status: err.status, headers: { "Cache-Control": "no-store" } });
  }
  if (err instanceof RepoError) {
    const status = err.code === "not_found" ? 404 : err.code === "invalid" ? 400 : 409;
    return NextResponse.json({ error: err.message, code: err.code, ...err.extra }, { status });
  }
  if (err instanceof ProviderError) {
    return NextResponse.json({ error: `Metadata provider problem — ${err.message}. You can still enter details manually.` }, { status: 502 });
  }
  if (err instanceof ZodError) {
    const issues = err.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`);
    return NextResponse.json({ error: "Some fields are invalid.", issues }, { status: 400 });
  }
  if (err instanceof SyntaxError) {
    return NextResponse.json({ error: "Request body isn't valid JSON." }, { status: 400 });
  }
  console.error("[api] unexpected error", err);
  return NextResponse.json({ error: "Something went wrong on the server. Nothing was saved." }, { status: 500 });
}

export async function readJson(req: Request): Promise<unknown> {
  const ct = req.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) throw new HttpError(415, "Expected application/json.");
  return req.json();
}

export function intParam(v: string | undefined): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(404, "Not found.");
  return n;
}
