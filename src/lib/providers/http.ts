export class ProviderError extends Error {
  constructor(
    public provider: string,
    message: string,
    public status?: number,
  ) {
    super(`${provider}: ${message}`);
  }
}

export function providerTimeout(): number {
  const n = Number(process.env.PROVIDER_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : 6000;
}

/** fetch + JSON with a hard timeout so a slow provider falls back instead of hanging the UI. */
export async function fetchJson<T>(provider: string, url: string, init: RequestInit = {}, timeoutMs = providerTimeout()): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...init,
      signal: ctrl.signal,
      headers: { Accept: "application/json", "User-Agent": "private-watch-journal/1.0", ...(init.headers ?? {}) },
      cache: "no-store",
    });
    if (!res.ok) throw new ProviderError(provider, `HTTP ${res.status}`, res.status);
    return (await res.json()) as T;
  } catch (e) {
    if (e instanceof ProviderError) throw e;
    if ((e as Error).name === "AbortError") throw new ProviderError(provider, `timed out after ${timeoutMs}ms`);
    throw new ProviderError(provider, (e as Error).message || "request failed");
  } finally {
    clearTimeout(timer);
  }
}

/** Try providers in order; first success wins. Collects errors for a useful message. */
export async function firstSuccessful<T>(attempts: { name: string; run: () => Promise<T> }[]): Promise<{ value: T; provider: string; errors: string[] }> {
  const errors: string[] = [];
  for (const a of attempts) {
    try {
      return { value: await a.run(), provider: a.name, errors };
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  throw new ProviderError("metadata", errors.length ? errors.join("; ") : "no provider configured");
}

export function yearOf(date: string | null | undefined): number | null {
  const m = /^(\d{4})/.exec(date ?? "");
  return m ? Number(m[1]) : null;
}

export function stripHtml(s: string | null | undefined): string | null {
  if (!s) return null;
  return s.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim() || null;
}
