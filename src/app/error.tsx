"use client";
import { useEffect, useState } from "react";

/** Shown instead of a bare "Application error": what happened, and what to try. */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const [health, setHealth] = useState<{ ok: boolean; error?: string; diskFreeMb?: number; errors?: { digest: string | null; message: string; path: string }[] } | null>(null);
  useEffect(() => {
    fetch("/api/health", { cache: "no-store" })
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => {});
  }, []);
  return (
    <main className="error-page">
      <div className="panel">
        <h1>Something went wrong</h1>
        <p>Your library is safe. This page couldn&apos;t load.</p>
        {health && !health.ok && <p className="notice">The app can&apos;t open your library right now: {health.error}</p>}
        {health?.diskFreeMb != null && health.diskFreeMb < 200 && (
          <p className="notice">Your Railway volume is almost full ({health.diskFreeMb} MB free). In Railway, open the volume and increase its size, then redeploy.</p>
        )}
        <div className="toolbar">
          <button className="btn primary" onClick={reset}>Try again</button>
          <a className="btn ghost" href="/">Home</a>
        </div>
        {(() => {
          const hit = health?.errors?.find((x) => x.digest === error.digest) ?? health?.errors?.[0];
          return hit ? (
            <p className="notice">
              What broke (send this to Claude): <code>{hit.message}</code> on <code>{hit.path}</code>
            </p>
          ) : null;
        })()}
        {error.digest && <p className="hint">Error code {error.digest}</p>}
      </div>
    </main>
  );
}
