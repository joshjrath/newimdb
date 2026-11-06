"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, posterSrc } from "@/lib/client/api";
import { useAction } from "../useAction";
import { Poster } from "../Poster";
import { WatchIcons } from "./WatchIcons";
import type { PersonPicks, Recommendation, RecommendState } from "@/lib/recommend/job";
import type { WatchOption } from "@/lib/providers/tmdb";
import { SortPicker, type SortChoice } from "../SortPicker";

type RecSort = "match" | "imdb" | "year" | "episodes";
const REC_SORTS: SortChoice<RecSort>[] = [
  { key: "match", label: "Best match for you", reverse: "Weakest match first", icon: "✦" },
  { key: "imdb", label: "IMDb rating: highest", reverse: "IMDb rating: lowest", icon: "IMDb" },
  { key: "year", label: "Newest first", reverse: "Oldest first", icon: "📅" },
  { key: "episodes", label: "Most episodes", reverse: "Fewest episodes", icon: "#" },
];
interface Filters {
  sort: RecSort;
  reversed: boolean;
  genres: string[];
  services: string[];
  minImdb: number;
  types: MediaType[];
}
const DEFAULT_FILTERS: Filters = { sort: "match", reversed: false, genres: [], services: [], minImdb: 0, types: ["anime", "tv", "movie"] };
const FILTER_KEY = "recommend-filters";
import type { MediaType } from "@/lib/domain/types";

type Data = { byType: Record<MediaType, Recommendation[]>; byPerson: PersonPicks[]; computedAt: string | null; state: RecommendState; tmdb: boolean };
const SECTIONS: { type: MediaType; title: string; cat: string }[] = [
  { type: "anime", title: "Anime", cat: "anime" },
  { type: "tv", title: "TV Shows", cat: "tv" },
  { type: "movie", title: "Movies", cat: "movies" },
];

/** IMDb's yellow badge with the rating, linking to the title on IMDb. */
function ImdbBadge({ r, big }: { r: Recommendation; big?: boolean }) {
  if (!r.imdb?.rating) return r.audience && !r.imdb ? <span className="aud-badge">{r.audience.source} {r.audience.score.toFixed(1)}</span> : null;
  return (
    <a className={`imdb-badge${big ? " big" : ""}`} href={`https://www.imdb.com/title/${r.imdb.id}/`} target="_blank" rel="noopener noreferrer" title={`${r.imdb.votes?.toLocaleString("en-GB") ?? "?"} votes on IMDb`}>
      <b>IMDb</b> {r.imdb.rating.toFixed(1)}
    </a>
  );
}

const becauseText = (r: Recommendation) => {
  const more = Math.max(0, r.supporters - r.because.length);
  return { names: r.because, more };
};

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
      // Gone from every row it was in (for you, and with anyone).
      const base = rec.baseKey ?? rec.key;
      const all = [...Object.values(d.byType).flat(), ...d.byPerson.flatMap((p) => p.items)].filter((x) => (x.baseKey ?? x.key) === base).map((x) => x.key);
      setGone(new Set([...gone, ...all]));
      if (action === "add") router.refresh();
    }
  };

  const card = (r: Recommendation) => (
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
                  <p className="rec-meta">{[r.year, r.genres[0], r.type !== "movie" && r.episodes ? `${r.episodes} eps` : null].filter(Boolean).join(" · ")} <ImdbBadge r={r} /></p>
                  {r.because[0] && (
                    <p className="rec-because small" title={`Because you loved ${r.because.join(", ")}`}>
                      Because of <b>{r.because[0]}</b>{r.supporters > 1 ? ` +${r.supporters - 1}` : ""}
                    </p>
                  )}
                  <WatchIcons options={r.watch} />
                </article>
  );

  // Workshop your picks: sort, genres, where it streams, a minimum IMDb rating, which kinds.
  const [f, setF] = useState<Filters>(DEFAULT_FILTERS);
  useEffect(() => {
    try {
      const v = JSON.parse(localStorage.getItem(FILTER_KEY) ?? "null");
      if (v) setF({ ...DEFAULT_FILTERS, ...v });
    } catch {}
  }, []);
  const update = (patch: Partial<Filters>) =>
    setF((cur) => {
      const next = { ...cur, ...patch };
      try {
        localStorage.setItem(FILTER_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  const everything = [...Object.values(d.byType).flat(), ...d.byPerson.flatMap((p) => p.items)];
  const allGenres = [...new Set(everything.flatMap((r) => r.genres))].sort();
  const allServices = (() => {
    const seen = new Map<string, WatchOption & { n: number }>();
    for (const r of everything) for (const w of r.watch) seen.set(w.name, { ...w, n: (seen.get(w.name)?.n ?? 0) + 1 });
    return [...seen.values()].sort((a, b) => b.n - a.n).slice(0, 14);
  })();
  const keep = (r: Recommendation) =>
    !gone.has(r.key) &&
    f.types.includes(r.type) &&
    (!f.genres.length || f.genres.some((g) => r.genres.includes(g))) &&
    (!f.services.length || r.watch.some((w) => f.services.includes(w.name))) &&
    (!f.minImdb || (r.imdb?.rating ?? r.audience?.score ?? 0) >= f.minImdb);
  const order = (list: Recommendation[]) => {
    const by: Record<RecSort, (a: Recommendation, b: Recommendation) => number> = {
      match: (a, b) => b.match - a.match,
      imdb: (a, b) => (b.imdb?.rating ?? b.audience?.score ?? -1) - (a.imdb?.rating ?? a.audience?.score ?? -1),
      year: (a, b) => (b.year ?? 0) - (a.year ?? 0),
      episodes: (a, b) => (b.episodes ?? -1) - (a.episodes ?? -1),
    };
    const sorted = [...list].sort(by[f.sort]);
    return f.reversed ? sorted.reverse() : sorted;
  };
  const live = (type: MediaType) => order(d.byType[type].filter(keep));
  const filtering = f.genres.length > 0 || f.services.length > 0 || f.minImdb > 0 || f.types.length < 3 || f.sort !== "match" || f.reversed;
  const hero = f.sort === "match" && !f.reversed ? order([...live("anime"), ...live("tv"), ...live("movie")])[0] : undefined;
  const empty = !SECTIONS.some((s) => live(s.type).length);
  const toggle = <T,>(list: T[], x: T) => (list.includes(x) ? list.filter((y) => y !== x) : [...list, x]);

  return (
    <div className="recs">
      <div className="recs-bar">
        <span className="hint">
          Learned from all {rated.toLocaleString("en-GB")} of your ratings: every genre, keyword, studio and decade you rate up or down. Each pick is backed by at least two of your favourites · updated {ago(d.computedAt)}
        </span>
        <button className="btn small primary" disabled={busy || d.state.running} onClick={refresh}>
          {d.state.running ? `Picking… ${d.state.total ? `${d.state.done}/${d.state.total}` : ""}` : "↻ Refresh suggestions"}
        </button>
      </div>

      <div className="rec-tools panel">
        <div className="rec-tools-row">
          <SortPicker options={REC_SORTS} value={f.sort} reversed={f.reversed} onChange={(sort, reversed) => update({ sort, reversed })} />
          <div className="chips" role="group" aria-label="Show">
            {SECTIONS.map((s) => (
              <button key={s.type} type="button" className="chip" aria-pressed={f.types.includes(s.type)} onClick={() => update({ types: f.types.includes(s.type) && f.types.length > 1 ? f.types.filter((t) => t !== s.type) : toggle(f.types, s.type) })}>
                {s.title}
              </button>
            ))}
          </div>
          <div className="chips min-imdb" role="group" aria-label="Minimum IMDb rating">
            <span className="imdb-badge"><b>IMDb</b> at least</span>
            <input
              className="input small"
              type="number"
              inputMode="decimal"
              min={0}
              max={10}
              step={0.1}
              placeholder="any"
              value={f.minImdb || ""}
              onChange={(e) => update({ minImdb: Math.max(0, Math.min(10, Number(e.target.value) || 0)) })}
              aria-label="Minimum IMDb rating, out of 10"
            />
            {[6, 7, 7.5, 8].map((n) => (
              <button key={n} type="button" className="chip" aria-pressed={f.minImdb === n} onClick={() => update({ minImdb: f.minImdb === n ? 0 : n })}>
                {n}+
              </button>
            ))}
          </div>
          {filtering && (
            <button type="button" className="btn small ghost" onClick={() => update(DEFAULT_FILTERS)}>Reset</button>
          )}
        </div>
        {allServices.length > 0 && (
          <div className="rec-tools-row">
            <span className="label">Streaming on</span>
            <div className="chips svc-chips" role="group" aria-label="Streaming on">
              {allServices.map((w) => (
                <button key={w.name} type="button" className="chip svc-chip" aria-pressed={f.services.includes(w.name)} onClick={() => update({ services: toggle(f.services, w.name) })} title={w.name}>
                  {w.logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={posterSrc(w.logoUrl) ?? ""} alt="" style={w.color ? { background: w.color } : undefined} />
                  ) : null}
                  {w.name}
                </button>
              ))}
            </div>
          </div>
        )}
        {allGenres.length > 0 && (
          <div className="rec-tools-row">
            <span className="label">Genre</span>
            <div className="chips" role="group" aria-label="Genre">
              {allGenres.map((g) => (
                <button key={g} type="button" className="chip" aria-pressed={f.genres.includes(g)} onClick={() => update({ genres: toggle(f.genres, g) })}>
                  {g}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      {filtering && !empty && <p className="hint">Showing picks that match your filters.</p>}
      {filtering && empty && <p className="notice">Nothing matches these filters. Loosen one, or press Reset.</p>}

      {d.state.running && empty && (
        <div className="progress" role="status" aria-live="polite">
          <div className="progress-track"><div className="progress-fill" style={{ width: `${d.state.total ? Math.round((d.state.done / d.state.total) * 100) : 5}%` }} /></div>
          <span className="progress-label">{d.state.step}…</span>
        </div>
      )}
      {!d.state.running && empty && !filtering && (
        <div className="panel">
          <p>{rated ? "No picks yet. Press Refresh to build them (it takes a minute or two)." : "Rate a few titles first, then your picks appear here."}</p>
          {!d.tmdb && <p className="hint">Movie and TV picks need a TMDB key (Railway → Variables → TMDB_READ_TOKEN). Anime picks work without one.</p>}
        </div>
      )}

      {hero && (
        <section className="rec-hero" style={hero.backdropUrl ? { backgroundImage: `linear-gradient(90deg, rgba(12,12,14,.96) 30%, rgba(12,12,14,.55) 70%, rgba(12,12,14,.2)), url(${posterSrc(hero.backdropUrl)})` } : undefined}>
          <div className="rec-hero-poster"><Poster url={hero.posterUrl} title={hero.title} priority /></div>
          <div className="rec-hero-body">
            <div className="toolbar" style={{ gap: 8 }}>
              <span className="rec-match big">{hero.match}% match</span>
              <ImdbBadge r={hero} big />
            </div>
            <h2>{hero.title}</h2>
            <p className="rec-meta">{[hero.year, ...hero.genres.slice(0, 3)].filter(Boolean).join(" · ")}</p>
            {hero.because.length > 0 && <p className="rec-because">
                Because you loved{" "}
                {becauseText(hero).names.map((b, i, all) => (
                  <span key={b}>{i > 0 && (i === all.length - 1 && !becauseText(hero).more ? " and " : ", ")}<b>{b}</b></span>
                ))}
                {becauseText(hero).more > 0 && <> and {becauseText(hero).more} more of your favourites</>}
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

      {d.byPerson.map(({ person, items }) => {
        const list = order(items.filter(keep));
        if (!list.length) return null;
        return (
          <section key={person.id} className="rec-section rec-with" aria-labelledby={`rec-p${person.id}`}>
            <h2 id={`rec-p${person.id}`}>
              <span className="person-avatar" aria-hidden="true">{person.name.slice(0, 1).toUpperCase()}</span>
              Watch with {person.name} <span className="hint">from the {person.shared} titles you&apos;ve seen together, and how you rated them</span>
            </h2>
            <div className="rec-row">{list.map((r) => card(r))}</div>
          </section>
        );
      })}

      {SECTIONS.map((s) => {
        if (!f.types.includes(s.type)) return null; // switched off in Show
        const list = live(s.type).filter((r) => r.key !== hero?.key);
        if (!list.length) return s.type !== "anime" && !d.tmdb && !d.byType[s.type].length && !filtering ? (
          <section key={s.type} className="rec-section">
            <h2>{s.title}</h2>
            <p className="hint">Add a TMDB key to get {s.title.toLowerCase()} picks.</p>
          </section>
        ) : null;
        return (
          <section key={s.type} className={`rec-section cat-${s.cat}`} aria-labelledby={`rec-${s.type}`}>
            <h2 id={`rec-${s.type}`}>{s.title} <span className="hint">for you</span></h2>
            <div className="rec-row">
              {list.map((r) => card(r))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
