"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import { useAction } from "../useAction";
import { plural } from "@/lib/domain/text";
import { TYPE_LABEL } from "@/lib/domain/types";
import type { AnimeCheckState } from "@/lib/anime/job";

type Res = { check: AnimeCheckState; unchecked: number };

/** Settings → Anime sorting: anime filed under TV Shows or Movies is moved to Anime by itself. */
export function AnimeCheckSettings() {
  const [s, setS] = useState<Res | null>(null);
  const [undone, setUndone] = useState<Set<number>>(new Set());
  const { busy, run } = useAction();
  const load = useCallback(async (start = false) => {
    try {
      setS(await api<Res>("/api/anime-check", start ? { body: {} } : {}));
    } catch {}
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    if (!s?.check.running) return;
    const t = setInterval(() => load(), 3000);
    return () => clearInterval(t);
  }, [s?.check.running, load]);

  const moveBack = async (id: number, to: string, title: string) => {
    const r = await run(() => api("/api/media/bulk", { body: { ids: [id], action: "set_type", mediaType: to } }), { ok: `Moved ${title} back. It'll stay there.` });
    if (r) setUndone(new Set([...undone, id]));
  };

  const c = s?.check;
  return (
    <section className="panel" aria-labelledby="anime-h">
      <header>
        <h2 id="anime-h">Anime sorting</h2>
        <span className="hint">Automatic. Anything you move yourself stays where you put it.</span>
      </header>
      <p className="muted">
        Animated titles are checked against TVmaze, AniList and TMDB (when its key is set). Japanese anime filed under TV Shows or Movies, like Bleach, moves to Anime, and animation that isn&apos;t anime moves out. Reviews, ratings and episodes come along unchanged. To move a title yourself, select it in <Link href="/studio">Studio</Link> and choose &quot;Move to&quot;.
      </p>
      {c && (
        <div className="stack tight">
          {c.running ? (
            <div className="progress" role="status" aria-live="polite">
              <div className="progress-track"><div className="progress-fill" style={{ width: `${c.total ? Math.round((c.checked / c.total) * 100) : 0}%` }} /></div>
              <span className="progress-label">Checking animated titles: {c.checked} of {c.total} · {plural(c.moved.length, "moved", "moved")}</span>
            </div>
          ) : (
            <p className="hint">
              {c.finishedAt ? `Last check: ${plural(c.total, "title", "titles")} checked, ${plural(c.moved.length, "moved", "moved")}${c.failed ? `, ${c.failed} couldn't be checked (tried again later)` : ""}.` : "Not run yet."}
              {s.unchecked > 0 && ` ${plural(s.unchecked, "title", "titles")} still to check.`}
            </p>
          )}
          {c.moved.length > 0 && (
            <ul className="plain-list">
              {c.moved.map((m) => (
                <li key={m.id}>
                  <Link href={`/studio/${m.id}`}>{m.title}</Link> <span className="hint">{TYPE_LABEL[m.from]} → {TYPE_LABEL[m.to]}</span>{" "}
                  {undone.has(m.id) ? (
                    <span className="hint">moved back</span>
                  ) : (
                    <button className="btn small ghost" disabled={busy} onClick={() => moveBack(m.id, m.from, m.title)}>Move back</button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {!c.running && s.unchecked > 0 && <div><button className="btn" disabled={busy} onClick={() => load(true)}>Check now</button></div>}
        </div>
      )}
    </section>
  );
}
