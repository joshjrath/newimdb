/** Runs once when the server starts: record the deploy (and back up) before the first visit. */
export async function register() {
  // Next replaces NEXT_RUNTIME at build time, so the edge build drops this import entirely.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./instrumentation-node");
  }
}

/** Every server error is kept (briefly, in memory) so the error page can show you what happened. */
export async function onRequestError(err: unknown, request: { path: string }) {
  const e = err as Error & { digest?: string };
  const { logError } = await import("./lib/errorLog");
  logError({ at: new Date().toISOString(), path: request.path, digest: e.digest ?? null, message: `${e.name ?? "Error"}: ${e.message ?? String(e)}`.slice(0, 500) });
}
