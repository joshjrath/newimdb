"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import { plural } from "@/lib/domain/text";
import type { SyncState } from "@/lib/episodes/sync";

function ago(iso: string | null) {
  if (!iso) return "not yet";
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/** Settings → New episodes: shows update themselves; this shows the latest check and runs one now. */
export function EpisodeSyncSettings() {
  const [s, setS] = useState<SyncState | null>(null);
  const load = useCallback(async (start = false) => {
    try {
      setS((await api<{ sync: SyncState }>("/api/episodes/sync", start ? { body: {} } : {})).sync);
    } catch {}
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    if (!s?.running) return;
    const t = setInterval(() => load(), 3000);
    return () => clearInterval(t);
  }, [s?.running, load]);

  return (
    <section className="panel" aria-labelledby="sync-h">
      <header>
        <h2 id="sync-h">New episodes</h2>
        <span className="hint">Checked automatically: shows you&apos;re watching every 6 hours, everything else daily.</span>
      </header>
      <p className="muted">
        New episodes and seasons are added to your shows by themselves, using TVmaze (and TMDB when its key is set), so you never need to re-import. Episodes that aren&apos;t out yet show as TBA and don&apos;t count against your progress. Nothing you&apos;ve rated is ever removed.
      </p>
      {s && (
        <div className="stack tight">
          {s.running ? (
            <div className="progress" role="status" aria-live="polite">
              <div className="progress-track"><div className="progress-fill" style={{ width: `${s.total ? Math.round((s.checked / s.total) * 100) : 0}%` }} /></div>
              <span className="progress-label">Checking shows: {s.checked} of {s.total} · {plural(s.added, "new episode", "new episodes")} so far</span>
            </div>
          ) : (
            <p className="hint">
              Last check {ago(s.finishedAt)}
              {s.finishedAt ? `: ${plural(s.total, "show", "shows")} checked, ${plural(s.added, "new episode", "new episodes")}${s.newSeasons ? `, ${plural(s.newSeasons, "new season", "new seasons")}` : ""}${s.noMatch ? `, ${s.noMatch} not found on TVmaze/TMDB` : ""}${s.failed ? `, ${s.failed} couldn't be checked` : ""}.` : "."}
            </p>
          )}
          {s.updated.length > 0 && (
            <ul className="plain-list">
              {s.updated.slice(0, 50).map((u) => (
                <li key={u.id}><Link href={`/studio/${u.id}`}>{u.title}</Link> <span className="hint">+{u.added}</span></li>
              ))}
            </ul>
          )}
          <div><button className="btn" disabled={s.running} onClick={() => load(true)}>{s.running ? "Checking…" : "Check all shows now"}</button></div>
        </div>
      )}
    </section>
  );
}
