"use client";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

/** JSON fetch that only resolves on a confirmed 2xx — no false "saved" messages. */
export async function api<T = unknown>(url: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: init.method ?? (init.body !== undefined ? "POST" : "GET"),
      headers: init.body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      credentials: "same-origin",
      cache: "no-store",
      signal: init.signal,
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiError(0, "Couldn't reach the server. Check your connection — nothing was saved.");
  }
  let body: Record<string, unknown> = {};
  try {
    body = await res.json();
  } catch {}
  if (res.status === 401) {
    throw new ApiError(401, "Your session has ended. Sign in again in another tab, then retry — your edits are still here.", body);
  }
  if (!res.ok) {
    const issues = Array.isArray(body.issues) ? ` (${(body.issues as string[]).join("; ")})` : "";
    throw new ApiError(res.status, String(body.error ?? `Request failed (${res.status}).`) + issues, body);
  }
  return body as T;
}

export function posterSrc(url: string | null | undefined, w?: number): string | null {
  if (!url) return null;
  if (url.startsWith("/api/uploads/")) return url;
  return `/api/poster?src=${encodeURIComponent(url)}${w ? `&w=${w}` : ""}`;
}
