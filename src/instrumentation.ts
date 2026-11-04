/** Runs once when the server starts: record the deploy (and back up) before the first visit. */
export async function register() {
  // Next replaces NEXT_RUNTIME at build time, so the edge build drops this import entirely.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./instrumentation-node");
  }
}
