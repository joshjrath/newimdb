export class ProviderError extends Error {
  constructor(
    public provider: string,
    message: string,
    public status?: number,
  ) {
    super(`${provider}: ${message}`);
  }
}

function providerTimeout(): number {
  const n = Number(process.env.PROVIDER_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : 6000;
}

/** fetch with a hard timeout so a slow provider falls back instead of hanging the UI. */
export async function fetchWithTimeout(provider: string, url: string, init: RequestInit = {}, timeoutMs = providerTimeout()): Promise<Response> {
  try {
    const res = await fetch(url, { cache: "no-store", ...init, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new ProviderError(provider, `HTTP ${res.status}`, res.status);
    return res;
  } catch (e) {
    if (e instanceof ProviderError) throw e;
    const name = (e as Error).name;
    if (name === "TimeoutError" || name === "AbortError") throw new ProviderError(provider, `timed out after ${timeoutMs}ms`);
    throw new ProviderError(provider, (e as Error).message || "request failed");
  }
}

export async function fetchJson<T>(provider: string, url: string, init: RequestInit = {}, timeoutMs?: number): Promise<T> {
  const res = await fetchWithTimeout(
    provider,
    url,
    { ...init, headers: { Accept: "application/json", "User-Agent": "private-watch-journal/1.0", ...(init.headers ?? {}) } },
    timeoutMs,
  );
  return (await res.json()) as T;
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
