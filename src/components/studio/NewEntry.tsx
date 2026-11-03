"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import { useToast } from "../Toasts";
import { Poster } from "../Poster";
import type { MediaType } from "@/lib/domain/types";
import type { ProviderDetails, SearchResult } from "@/lib/providers/types";

const TYPES: { t: MediaType; label: string }[] = [
  { t: "movie", label: "Movie" },
  { t: "tv", label: "TV show" },
  { t: "anime", label: "Anime" },
];

export function NewEntry({ initialType, providers }: { initialType: MediaType; providers: Record<MediaType, string[]> }) {
  const router = useRouter();
  const toast = useToast();
  const [type, setType] = useState<MediaType>(initialType);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState<ProviderDetails | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dupId, setDupId] = useState<number | null>(null);
  const [manual, setManual] = useState({ title: "", year: "", posterUrl: "", seasons: "" });

  const noProvider = providers[type].length === 0;

  const search = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!q.trim()) return;
    setSearching(true);
    setError(null);
    setDetails(null);
    try {
      const r = await api<{ results: SearchResult[]; provider: string }>(`/api/metadata/search?type=${type}&q=${encodeURIComponent(q)}`);
      setResults(r.results);
    } catch (err) {
      setResults(null);
      setError((err as Error).message);
    } finally {
      setSearching(false);
    }
  };

  const pick = async (r: SearchResult) => {
    setPicked(`${r.provider}:${r.providerId}`);
    setLoadingDetails(true);
    setError(null);
    try {
      const d = await api<ProviderDetails>(`/api/metadata/details?type=${type}&provider=${r.provider}&id=${encodeURIComponent(r.providerId)}`);
      setDetails(d);
    } catch (err) {
      setError(`${(err as Error).message}`);
      // Fall back to what the search gave us so the owner can still add it.
      setDetails({ provider: r.provider, metadata: { title: r.title, year: r.year, posterUrl: r.posterUrl, overview: r.overview, ...(r.provider === "tmdb" ? { tmdbId: Number(r.providerId) } : r.provider === "jikan" ? { malId: Number(r.providerId) } : r.provider === "tvmaze" ? { tvmazeId: Number(r.providerId) } : { anilistId: Number(r.providerId) }) }, segments: [], warnings: ["Only basic details were available. Add seasons in Studio."] });
    } finally {
      setLoadingDetails(false);
    }
  };

  const create = async (body: unknown, allowDuplicate = false) => {
    setSaving(true);
    setDupId(null);
    try {
      const r = await api<{ media: { id: number } }>(`/api/media${allowDuplicate ? "?allowDuplicate=1" : ""}`, { body });
      toast.push("ok", "Added to your library.");
      router.push(`/studio/${r.media.id}`);
    } catch (err) {
      if (err instanceof ApiError && err.body.code === "duplicate") setDupId(Number(err.body.existingId));
      else toast.push("error", `Not added: ${(err as Error).message}`);
      setSaving(false);
    }
  };

  const fromDetails = () =>
    details && {
      type,
      metadata: details.metadata,
      review: { status: type === "movie" ? "completed" : "watching", visibility: "private" },
      segments: details.segments.map((s) => ({ ...s })),
    };

  const fromManual = () => {
    const counts = manual.seasons.split(/[,\s]+/).map(Number).filter((n) => Number.isInteger(n) && n >= 0);
    return {
      type,
      metadata: { title: manual.title.trim(), year: manual.year ? Number(manual.year) : null, posterUrl: manual.posterUrl.trim() || null },
      review: { status: type === "movie" ? "completed" : "watching", visibility: "private" },
      segments: type === "movie" ? [] : counts.map((n, i) => ({ kind: "season", label: `Season ${i + 1}`, seasonNumber: i + 1, courNumber: null, episodeCount: n })),
    };
  };

  return (
    <div className="studio-grid two">
      <div style={{ display: "grid", gap: 20 }}>
        <div className="chips" role="radiogroup" aria-label="Type">
          {TYPES.map((x) => (
            <button key={x.t} type="button" role="radio" aria-checked={type === x.t} aria-pressed={type === x.t} className="chip" onClick={() => { setType(x.t); setResults(null); setDetails(null); setError(null); }}>
              {x.label}
            </button>
          ))}
        </div>

        <form className="toolbar" onSubmit={search} role="search">
          <label className="grow">
            <span className="visually-hidden">Title</span>
            <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${type === "movie" ? "movies" : type === "tv" ? "TV shows" : "anime"} by title`} disabled={noProvider} />
          </label>
          <button className="btn primary" disabled={searching || noProvider}>{searching ? "Searching…" : "Search"}</button>
        </form>
        {noProvider && <div className="notice">Movie search needs a TMDB key on the server (TMDB_READ_TOKEN). You can still add movies by hand on the right.</div>}
        {error && <div className="notice error" role="alert">{error}</div>}

        {results && (results.length ? (
          <div className="results" aria-label="Search results">
            {results.map((r) => (
              <button key={`${r.provider}:${r.providerId}`} type="button" className="result" aria-pressed={picked === `${r.provider}:${r.providerId}`} onClick={() => pick(r)}>
                <Poster url={r.posterUrl} title={r.title} />
                <span style={{ display: "grid", gap: 4, alignContent: "start" }}>
                  <strong style={{ fontFamily: "var(--font-display)" }}>{r.title}</strong>
                  <span className="hint">{[r.year, r.note].filter(Boolean).join(" · ")}</span>
                  {r.originalTitle && <span className="hint">{r.originalTitle}</span>}
                  <span className="src">from {r.provider}</span>
                </span>
              </button>
            ))}
          </div>
        ) : <p className="hint">No matches. Try another spelling, or add it by hand.</p>)}

        {loadingDetails && <p className="hint">Loading details and episodes…</p>}
        {details && !loadingDetails && (
          <div className="panel">
            <header><h2>{details.metadata.title}</h2><span className="hint">from {details.provider}</span></header>
            {details.warnings.map((w) => <div key={w} className="notice warn">{w}</div>)}
            {details.segments.length > 0 && (
              <p className="hint">
                {details.segments.length} {details.segments.length === 1 ? "segment" : "segments"}:{" "}
                {details.segments.map((s) => `${s.label} (${s.episodeCount})`).join(", ")}. You can rename, split into cours, reorder or add OVAs and specials after adding.
              </p>
            )}
            {dupId && (
              <div className="notice warn">
                This is already in your library. <a href={`/studio/${dupId}`}>Open the existing entry</a> or{" "}
                <button className="btn small" onClick={() => create(fromDetails(), true)}>add a second copy</button>
              </div>
            )}
            <div><button className="btn primary" disabled={saving} onClick={() => create(fromDetails())}>{saving ? "Adding…" : "Add to library"}</button></div>
          </div>
        )}
      </div>

      <form
        className="panel"
        onSubmit={(e) => {
          e.preventDefault();
          if (manual.title.trim()) create(fromManual());
        }}
      >
        <header><h2>Add by hand</h2></header>
        <label className="field"><span>Title</span><input className="input" required value={manual.title} onChange={(e) => setManual({ ...manual, title: e.target.value })} /></label>
        <label className="field"><span>Year</span><input className="input" inputMode="numeric" pattern="\d{4}" value={manual.year} onChange={(e) => setManual({ ...manual, year: e.target.value })} /></label>
        <label className="field"><span>Poster image URL</span><input className="input" type="url" value={manual.posterUrl} onChange={(e) => setManual({ ...manual, posterUrl: e.target.value })} /><span className="hint">Or upload one after adding.</span></label>
        {type !== "movie" && (
          <label className="field">
            <span>Episodes per season</span>
            <input className="input" placeholder="e.g. 10, 10, 8" value={manual.seasons} onChange={(e) => setManual({ ...manual, seasons: e.target.value })} />
            <span className="hint">Cours, OVAs, movies and specials can be added after.</span>
          </label>
        )}
        <div><button className="btn" disabled={saving || !manual.title.trim()}>Add</button></div>
      </form>
    </div>
  );
}
