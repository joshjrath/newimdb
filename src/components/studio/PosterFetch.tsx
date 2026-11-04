"use client";
import { useCallback, useEffect, useState } from "react";
import { plural } from "@/lib/domain/text";
import type { PosterJob } from "@/lib/posters/job";

type Status = { job: PosterJob | null; missing: number; tmdb: boolean };

export const POSTERS_STARTED = "posters:started";

/** Fill in posters for titles that don't have one (e.g. everything from an IMDb import). */
export function PosterFetch() {
  const [s, setS] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const running = s?.job?.state === "running";

  const load = useCallback(async (start = false) => {
    try {
      const res = await fetch("/api/posters", start ? { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" } : { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status}).`);
      setS(body);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    load();
    const onStart = () => load();
    window.addEventListener(POSTERS_STARTED, onStart);
    return () => window.removeEventListener(POSTERS_STARTED, onStart);
  }, [load]);

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => load(), 2500);
    return () => clearInterval(t);
  }, [running, load]);

  if (!s) return null;
  const j = s.job;
  if (!running && s.missing === 0 && !j) return null;
  const pct = j && j.total ? Math.round((j.done / j.total) * 100) : 0;

  return (
    <section className="panel" aria-labelledby="posters-h">
      <header>
        <h2 id="posters-h">Posters</h2>
        <span className="hint">Fills in only missing posters. Nothing you've set is changed.</span>
      </header>
      {running && j ? (
        <div className="job-progress" role="status" aria-live="polite">
          <div className="progress">
            <div className="progress-track"><div className="progress-fill" style={{ width: `${pct}%` }} /></div>
            <span className="progress-label">
              Finding posters: {j.done} of {j.total} · {plural(j.found, "poster", "posters")} found
            </span>
          </div>
          <p className="hint">This runs on the server, so you can keep using the site or close this page.</p>
        </div>
      ) : (
        <div className="stack tight">
          {j && j.state !== "running" && (
            <p className="muted">
              Last run: found {plural(j.found, "poster", "posters")}
              {j.notFound ? `, ${j.notFound} not found` : ""}
              {j.failed ? `, ${j.failed} couldn't be checked (try again later)` : ""}
              {j.needsKey ? `, ${plural(j.needsKey, "movie", "movies")} skipped (needs a TMDB key)` : ""}.
            </p>
          )}
          {s.missing > 0 ? (
            <div className="toolbar">
              <span className="push-right">{plural(s.missing, "title has", "titles have")} no poster yet.</span>
              <button className="btn primary" onClick={() => load(true)}>Fetch missing posters</button>
            </div>
          ) : (
            <p className="hint">Every title has a poster.</p>
          )}
          {!s.tmdb && (
            <div className="notice warn">
              Movie posters need a TMDB key. Add <code>TMDB_READ_TOKEN</code> in Railway&apos;s Variables and redeploy. Shows and anime use TVmaze, which needs no key.
            </div>
          )}
        </div>
      )}
      {error && <div className="notice error" role="alert">{error}</div>}
    </section>
  );
}
