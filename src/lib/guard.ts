import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { validateSession } from "./auth";
import { RepoError } from "./errors";
import { ProviderError } from "./providers/http";
import { getMediaDetail } from "./repo/media";
import { SESSION_COOKIE } from "./session-cookie";

/**
 * Data access is authorised here, once per request (React `cache`), so a page and its
 * generateMetadata share one session lookup and one database read.
 */
export const isOwner = cache(async (): Promise<boolean> => validateSession((await cookies()).get(SESSION_COOKIE)?.value));

/** Server Components / pages: redirect to login unless the owner is signed in. */
export async function requireOwnerPage(nextPath: string): Promise<void> {
  if (!(await isOwner())) redirect(`/login?next=${encodeURIComponent(nextPath)}`);
}

/** Owner-only entry loader for pages and their metadata. Returns null when signed out or missing. */
export const loadOwnerMedia = cache(async (id: number | null) =>
  // Episode overviews are only used by the API, so pages skip them.
  id != null && (await isOwner()) ? getMediaDetail(id, undefined, { overview: false }) : null,
);

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public extra?: Record<string, unknown>,
  ) {
    super(message);
  }
}

/** CSRF defence for writes: same-origin only, on top of the SameSite cookie. */
export function assertSameOrigin(req: Request) {
  if (req.method === "GET" || req.method === "HEAD") return;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const origin = req.headers.get("origin");
  if (origin) {
    let originHost: string | null = null;
    try {
      originHost = new URL(origin).host;
    } catch {}
    if (originHost !== host) throw new HttpError(403, "Cross-origin request refused.");
  } else if ((req.headers.get("sec-fetch-site") ?? "same-origin") !== "same-origin") {
    throw new HttpError(403, "Cross-site request refused.");
  }
}

type Handler<C> = (req: Request, ctx: C) => Promise<Response | unknown>;

function withApiPolicy<C>(fn: Handler<C>, auth: "owner" | "public") {
  return async (req: Request, ctx: C): Promise<Response> => {
    let res: Response;
    try {
      assertSameOrigin(req);
      if (auth === "owner" && !(await isOwner())) throw new HttpError(401, "Sign in required.");
      const out = await fn(req, ctx);
      res = out instanceof Response ? out : NextResponse.json(out ?? { ok: true });
    } catch (err) {
      res = errorResponse(err);
    }
    // Applies to errors too: nothing from the API is ever cached by a shared cache.
    if (!res.headers.has("Cache-Control")) res.headers.set("Cache-Control", "private, no-store");
    return res;
  };
}

/** Wrap every owner API route: same-origin writes, owner session, consistent JSON errors, never cached. */
export const ownerApi = <C = unknown>(fn: Handler<C>) => withApiPolicy(fn, "owner");
/** Same policy without the session requirement (sign in / sign out). */
export const publicApi = <C = unknown>(fn: Handler<C>) => withApiPolicy(fn, "public");

function errorResponse(err: unknown): Response {
  if (err instanceof HttpError) return NextResponse.json({ error: err.message, ...err.extra }, { status: err.status });
  if (err instanceof RepoError) return NextResponse.json({ error: err.message, code: err.code, ...err.extra }, { status: err.status });
  if (err instanceof ProviderError) {
    return NextResponse.json({ error: `Metadata provider problem — ${err.message}. You can still enter details manually.` }, { status: 502 });
  }
  if (err instanceof ZodError) {
    const issues = err.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`);
    return NextResponse.json({ error: "Some fields are invalid.", issues }, { status: 400 });
  }
  if (err instanceof SyntaxError) return NextResponse.json({ error: "Request body isn't valid JSON." }, { status: 400 });
  console.error("[api] unexpected error", err);
  return NextResponse.json({ error: "Something went wrong on the server. Nothing was saved." }, { status: 500 });
}

/** Parse a JSON body with a zod schema. */
export async function readJson<T>(req: Request, schema: { parse: (v: unknown) => T }): Promise<T> {
  if (!(req.headers.get("content-type") ?? "").includes("application/json")) throw new HttpError(415, "Expected application/json.");
  return schema.parse(await req.json());
}

export function intParamOrNull(v: string | undefined): number | null {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function intParam(v: string | undefined): number {
  const n = intParamOrNull(v);
  if (n == null) throw new HttpError(404, "Not found.");
  return n;
}

/** Await Next's route params and parse every value as a positive integer id. */
export async function idParams<K extends string>(params: Promise<Record<K, string>>): Promise<Record<K, number>> {
  const p = await params;
  return Object.fromEntries(Object.entries(p).map(([k, v]) => [k, intParam(v as string)])) as Record<K, number>;
}
