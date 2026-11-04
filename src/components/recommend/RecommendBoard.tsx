"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, posterSrc } from "@/lib/client/api";
import { useAction } from "../useAction";
import { Poster } from "../Poster";
import { WatchIcons } from "./WatchIcons";
import type { Recommendation, RecommendState } from "@/lib/recommend/job";
import type { MediaType } from "@/lib/domain/types";

type Data = { byType: Record<MediaType, Recommendation[]>; computedAt: string | null; state: RecommendState; tmdb: boolean };
const SECTIONS: { type: MediaType; title: string; cat: string }[] = [
  { type: "anime", title: "Anime", cat: "anime" },
  { type: "tv", title: "TV Shows", cat: "tv" },
  { type: "movie", title: "Movies", cat: "movies" },
];

function ago(iso: string | null) {
  if (!iso) return "never";
  const h = Math.round((Date.now() - Date.parse(iso)) / 3_600_000);
  return h < 1 ? "just now" : h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
}

/** The Recommended page: a hero pick, then a row each for Anime, TV and Movies. */
export function RecommendBoard({ initial, rated }: { initial: Data; rated: number }) {
  const [d, setD] = useState(initial);
  const [gone, setGone] = useState<Set<string>>(new Set());
  const { busy, run } = useAction();
  const router = useRouter();

  useEffect(() => {
    if (!d.state.running) return;
    const t = setInterval(async () => {
      try {
        setD(await api<Data>("/api/recommendations"));
      } catch {}
    }, 3000);
    return () => clearInterval(t);
  }, [d.state.running]);

  const refresh = async () => {
    const r = await run(() => api<Data>("/api/recommendations", { body: {} }));
    if (r) setD(r);
  };
  const act = async (rec: Recommendation, action: "add" | "dismiss") => {
    const r = await run(() => api<{ media?: { href: string } }>(`/api/recommendations/${encodeURIComponent(rec.key)}`, { body: { action } }), {
      ok: action === "add" ? `Added ${rec.title} to Plan to watch.` : `Got it, no more ${rec.title}.`,
    });
    if (r) {
      setGone(new Set([...gone, rec.key]));
      if (action === "add") router.refresh();
    }
  };

  const live = (type: MediaType) => d.byType[type].filter((r) => !gone.has(r.key));
  const hero = [...live("anime"), ...live("tv"), ...live("movie")].sort((a, b) => b.match - a.match)[0];
  const empty = !SECTIONS.some((s) => live(s.type).length);

  return (
    <div className="recs">
      <div className="recs-bar">
        <span className="hint">
          From your {rated.toLocaleString("en-GB")} ratings, favourite genres and what you&apos;re watching · updated {ago(d.computedAt)}
        </span>
        <button className="btn small" disabled={busy || d.state.running} onClick={refresh}>
          {d.state.running ? `Picking… ${d.state.total ? `${d.state.done}/${d.state.total}` : ""}` : "Refresh"}
        </button>
      </div>

      {d.state.running && empty && (
        <div className="progress" role="status" aria-live="polite">
          <div className="progress-track"><div className="progress-fill" style={{ width: `${d.state.total ? Math.round((d.state.done / d.state.total) * 100) : 5}%` }} /></div>
          <span className="progress-label">{d.state.step}…</span>
        </div>
      )}
      {!d.state.running && empty && (
        <div className="panel">
          <p>{rated ? "No picks yet. Press Refresh to build them (it takes a minute or two)." : "Rate a few titles first, then your picks appear here."}</p>
          {!d.tmdb && <p className="hint">Movie and TV picks need a TMDB key (Railway → Variables → TMDB_READ_TOKEN). Anime picks work without one.</p>}
        </div>
      )}

      {hero && (
        <section className="rec-hero" style={hero.backdropUrl ? { backgroundImage: `linear-gradient(90deg, rgba(12,12,14,.96) 30%, rgba(12,12,14,.55) 70%, rgba(12,12,14,.2)), url(${posterSrc(hero.backdropUrl)})` } : undefined}>
          <div className="rec-hero-poster"><Poster url={hero.posterUrl} title={hero.title} priority /></div>
          <div className="rec-hero-body">
            <span className="rec-match big">{hero.match}% match</span>
            <h2>{hero.title}</h2>
            <p className="rec-meta">{[hero.year, ...hero.genres.slice(0, 3)].filter(Boolean).join(" · ")}</p>
            {hero.because.length > 0 && <p className="rec-because">
                Because you loved{" "}
                {hero.because.map((b, i) => (
                  <span key={b}>{i > 0 && " and "}<b>{b}</b></span>
                ))}
              </p>}
            {hero.overview && <p className="rec-overview">{hero.overview}</p>}
            <div className="rec-hero-watch">
              <span className="label">Where to watch</span>
              <WatchIcons options={hero.watch} size={40} max={8} />
            </div>
            <div className="toolbar">
              <button className="btn primary" disabled={busy} onClick={() => act(hero, "add")}>+ Plan to watch</button>
              <button className="btn ghost" disabled={busy} onClick={() => act(hero, "dismiss")}>Not interested</button>
            </div>
          </div>
        </section>
      )}

      {SECTIONS.map((s) => {
        const list = live(s.type).filter((r) => r.key !== hero?.key);
        if (!list.length) return s.type !== "anime" && !d.tmdb && !empty ? (
          <section key={s.type} className="rec-section">
            <h2>{s.title}</h2>
            <p className="hint">Add a TMDB key to get {s.title.toLowerCase()} picks.</p>
          </section>
        ) : null;
        return (
          <section key={s.type} className={`rec-section cat-${s.cat}`} aria-labelledby={`rec-${s.type}`}>
            <h2 id={`rec-${s.type}`}>{s.title} <span className="hint">for you</span></h2>
            <div className="rec-row">
              {list.map((r) => (
                <article key={r.key} className="rec-card">
                  <div className="rec-poster">
                    <Poster url={r.posterUrl} title={r.title} />
                    <span className="rec-match">{r.match}%</span>
                    <div className="rec-actions">
                      <button className="btn small primary" disabled={busy} onClick={() => act(r, "add")} aria-label={`Add ${r.title} to Plan to watch`}>+ Plan</button>
                      <button className="btn small ghost" disabled={busy} onClick={() => act(r, "dismiss")} aria-label={`Not interested in ${r.title}`}>✕</button>
                    </div>
                  </div>
                  <h3>{r.title}</h3>
                  <p className="rec-meta">{[r.year, r.genres[0]].filter(Boolean).join(" · ")}</p>
                  {r.because[0] && <p className="rec-because small">Because of <b>{r.because[0]}</b></p>}
                  <WatchIcons options={r.watch} />
                </article>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
