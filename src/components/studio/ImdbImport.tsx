"use client";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { api } from "@/lib/client/api";
import { useToast } from "../Toasts";
import { Stars } from "../Stars";
import { useUnsavedGuard } from "./useUnsavedGuard";
import { formatDate } from "@/lib/format";
import { plural } from "@/lib/domain/text";
import { MEDIA_TYPES, typePluralLabel, type MediaType } from "@/lib/domain/types";

type Choice = MediaType | "skip";

interface Title {
  imdbId: string;
  kind: "movie" | "show";
  guess: MediaType;
  animated: boolean;
  title: string;
  originalTitle: string | null;
  year: number | null;
  titleType: string;
  rating: number | null;
  ratedOn: string | null;
  ratedEpisodes: number;
  episodeCount: number;
  seasonCount: number;
  existingId: number | null;
}

interface Preview {
  id: string;
  titles: Title[];
  unresolved: { imdbId: string; title: string; rating: number; reason: string }[];
  skipped: { imdbId: string; title: string; titleType: string }[];
  invalid: number;
  lookup: { used: boolean; error: string | null };
}

type Filter = "all" | MediaType | "animated" | "existing" | "skip";
const PAGE = 100;
const CHOICE_LABEL: Record<Choice, string> = { movie: "Movie", tv: "TV", anime: "Anime", skip: "Skip" };

export function ImdbImport() {
  const toast = useToast();
  const router = useRouter();
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [lookup, setLookup] = useState(true);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [mode, setMode] = useState<"fill" | "overwrite">("fill");
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState<null | "preview" | "import">(null);
  const [error, setError] = useState<string | null>(null);
  useUnsavedGuard(Boolean(preview), "You have an IMDb import preview that hasn't been imported. Leave anyway?");

  const choiceOf = (t: Title): Choice => choices[t.imdbId] ?? t.guess;

  const totals = useMemo(() => {
    const c = { movie: 0, tv: 0, anime: 0, skip: 0, episodes: 0, shows: 0, existing: 0 };
    for (const t of preview?.titles ?? []) {
      const ch = choices[t.imdbId] ?? t.guess;
      c[ch]++;
      if (ch !== "skip" && ch !== "movie") {
        c.episodes += t.ratedEpisodes;
        if (t.ratedEpisodes) c.shows++;
      }
      if (t.existingId) c.existing++;
    }
    return c;
  }, [preview, choices]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (preview?.titles ?? []).filter((t) => {
      const ch = choices[t.imdbId] ?? t.guess;
      if (filter === "animated" && !t.animated) return false;
      if (filter === "existing" && !t.existingId) return false;
      if ((MEDIA_TYPES as readonly string[]).includes(filter) || filter === "skip") if (ch !== filter) return false;
      return !needle || t.title.toLowerCase().includes(needle) || (t.originalTitle ?? "").toLowerCase().includes(needle) || t.imdbId === needle;
    });
  }, [preview, choices, filter, q]);

  const runPreview = async () => {
    if (!file) return;
    setBusy("preview");
    setError(null);
    try {
      const p = await api<Preview>("/api/import/imdb/preview", { body: { csv: file.text, lookupEpisodes: lookup } });
      setPreview(p);
      setChoices({});
      setFilter("all");
      setPage(0);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const runImport = async () => {
    if (!preview) return;
    setBusy("import");
    try {
      const overrides = Object.fromEntries(Object.entries(choices).filter(([id, c]) => preview.titles.find((t) => t.imdbId === id)?.guess !== c));
      const { counts } = await api<{ counts: { created: number; updated: number; skipped: number; episodes: number; notPlaced: number } }>("/api/import/imdb/commit", {
        body: { planId: preview.id, overrides, mode },
      });
      toast.push(
        "ok",
        `Imported from IMDb: ${counts.created} added, ${counts.updated} already here and updated, ${plural(counts.episodes, "episode rating", "episode ratings")}, ${counts.skipped} skipped. All private.`,
      );
      setPreview(null);
      setFile(null);
      router.refresh();
    } catch (e) {
      toast.push("error", `Import not applied, nothing changed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const setAll = (pred: (t: Title) => boolean, c: Choice) =>
    setChoices((cur) => {
      const next = { ...cur };
      for (const t of preview?.titles ?? []) if (pred(t)) next[t.imdbId] = c;
      return next;
    });

  const pages = Math.max(1, Math.ceil(shown.length / PAGE));
  const rows = shown.slice(page * PAGE, page * PAGE + PAGE);
  const filters: [Filter, string, number][] = [
    ["all", "All", preview?.titles.length ?? 0],
    ["movie", "Movies", totals.movie],
    ["tv", "TV Shows", totals.tv],
    ["anime", "Anime", totals.anime],
    ["animated", "Animated: check these", preview?.titles.filter((t) => t.animated).length ?? 0],
    ["existing", "Already here", totals.existing],
    ["skip", "Skipped", totals.skip],
  ];

  return (
    <section className="panel" aria-labelledby="imdb-h">
      <header>
        <h2 id="imdb-h">Import from IMDb</h2>
        <span className="hint">One-time import of every rating. Nothing is posted anywhere.</span>
      </header>

      {!preview && (
        <div className="stack tight">
          <ol className="steps">
            <li>On IMDb, open <b>Your ratings</b>, then the <b>⋯</b> menu, then <b>Export</b>.</li>
            <li>IMDb prepares the file. Download it from the <b>Exports</b> page when it's ready.</li>
            <li>Choose the file here. Each row has IMDb's own ID, so titles with the same name never get mixed up.</li>
          </ol>
          <div className="toolbar">
            <label className="btn" htmlFor="imdb-file">
              {file ? "Choose a different file" : "Choose ratings.csv"}
              <input
                id="imdb-file"
                type="file"
                accept=".csv,text/csv"
                className="visually-hidden"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (f) setFile({ name: f.name, text: await f.text() });
                }}
              />
            </label>
            {file && <span className="hint">{file.name}</span>}
          </div>
          <label className="check" htmlFor="imdb-lookup">
            <input id="imdb-lookup" type="checkbox" checked={lookup} onChange={(e) => setLookup(e.target.checked)} />
            Place episode ratings in their show and season
          </label>
          <p className="hint">
            This uses IMDb's free public episode lists, downloaded once to your server (about 250 MB) and reused for a month. Without it, shows and films still import, but episode ratings are listed as not placed.
          </p>
          {error && <div className="notice error" role="alert">{error}</div>}
          <div>
            <button className="btn primary" disabled={!file || busy !== null} onClick={runPreview}>
              {busy === "preview" ? (lookup ? "Reading and matching episodes… this can take a couple of minutes" : "Reading…") : "Preview import"}
            </button>
          </div>
        </div>
      )}

      {preview && (
        <div className="stack">
          <div className="import-totals">
            <div className="block cat-movies"><span className="v">{totals.movie}</span><span className="k">Movies</span></div>
            <div className="block cat-tv"><span className="v">{totals.tv}</span><span className="k">TV Shows</span></div>
            <div className="block cat-anime"><span className="v">{totals.anime}</span><span className="k">Anime</span></div>
            <div className="stat"><span className="v">{totals.episodes}</span><span className="k">Episode ratings in {plural(totals.shows, "show", "shows")}</span></div>
          </div>
          {preview.lookup.error && <div className="notice warn">Episode lookup didn't work: {preview.lookup.error}. Episode ratings are listed under "Not placed".</div>}
          {(preview.unresolved.length > 0 || preview.skipped.length > 0 || preview.invalid > 0) && (
            <details className="notice">
              <summary>
                {[
                  preview.unresolved.length && `${plural(preview.unresolved.length, "episode rating", "episode ratings")} not placed`,
                  preview.skipped.length && `${preview.skipped.length} games, podcasts or music videos left out`,
                  preview.invalid && `${plural(preview.invalid, "row", "rows")} unreadable`,
                ].filter(Boolean).join(" · ")}
              </summary>
              <ul className="plain-list">
                {preview.unresolved.slice(0, 200).map((u) => <li key={u.imdbId}>{u.title} <span className="hint">({u.imdbId}) {u.reason}</span></li>)}
                {preview.skipped.slice(0, 200).map((u) => <li key={u.imdbId}>{u.title} <span className="hint">({u.titleType})</span></li>)}
              </ul>
            </details>
          )}

          <div className="chips" role="tablist" aria-label="Show">
            {filters.map(([f, label, n]) => (
              <button key={f} className="chip" role="tab" aria-selected={filter === f} aria-pressed={filter === f} onClick={() => { setFilter(f); setPage(0); }}>
                {label} <span className="hint">{n}</span>
              </button>
            ))}
          </div>
          <div className="toolbar">
            <label className="grow" htmlFor="imdb-q">
              <span className="visually-hidden">Search the import</span>
              <input id="imdb-q" className="input" type="search" placeholder="Search titles or tt IDs" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} />
            </label>
            {filter === "animated" && (
              <>
                <button className="btn small" onClick={() => setAll((t) => t.animated && t.kind === "show", "anime")}>Animated shows → Anime</button>
                <button className="btn small" onClick={() => setAll((t) => t.animated && t.kind === "show", "tv")}>Animated shows → TV</button>
              </>
            )}
          </div>

          <div className="table-wrap">
            <table className="manage">
              <thead>
                <tr><th>Title</th><th>On IMDb</th><th>Your rating</th><th>Rated</th><th>Episodes</th><th>Import as</th></tr>
              </thead>
              <tbody>
                {rows.map((t) => (
                  <tr key={t.imdbId}>
                    <td>
                      <span className="t">{t.title}</span> <span className="hint">{t.year ?? ""}</span>
                      <div className="hint">{[t.originalTitle, t.imdbId, t.existingId && "already in your library"].filter(Boolean).join(" · ")}</div>
                    </td>
                    <td className="hint">{t.titleType}</td>
                    <td>{t.rating != null ? <Stars value={t.rating} size={13} /> : <span className="hint">–</span>}</td>
                    <td className="hint">{formatDate(t.ratedOn)}</td>
                    <td className="hint">{t.kind === "show" ? `${t.ratedEpisodes} rated of ${t.episodeCount}` : ""}</td>
                    <td>
                      <div className="choice" role="radiogroup" aria-label={`Import ${t.title} as`}>
                        {(["movie", "tv", "anime", "skip"] as Choice[]).map((c) => (
                          <button key={c} type="button" role="radio" aria-checked={choiceOf(t) === c} className={`choice-${c}`} onClick={() => setChoices((cur) => ({ ...cur, [t.imdbId]: c }))}>
                            {CHOICE_LABEL[c]}
                          </button>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={6} className="hint" style={{ textAlign: "center", padding: 28 }}>Nothing in this view.</td></tr>}
              </tbody>
            </table>
          </div>
          {pages > 1 && (
            <nav className="pager" aria-label="Import pages">
              {page > 0 && <button className="btn small" onClick={() => setPage(page - 1)}>Previous</button>}
              <span>{shown.length} titles · page {page + 1} of {pages}</span>
              {page < pages - 1 && <button className="btn small" onClick={() => setPage(page + 1)}>Next</button>}
            </nav>
          )}

          {totals.existing > 0 && (
            <fieldset className="plain-fieldset">
              <legend className="label">For the {plural(totals.existing, "title", "titles")} already in your library</legend>
              <div className="toolbar" style={{ gap: 18 }}>
                <label className="check" htmlFor="mode-fill"><input id="mode-fill" type="radio" name="imdb-mode" checked={mode === "fill"} onChange={() => setMode("fill")} /> Keep ratings I've set here, fill in the rest</label>
                <label className="check" htmlFor="mode-over"><input id="mode-over" type="radio" name="imdb-mode" checked={mode === "overwrite"} onChange={() => setMode("overwrite")} /> Use IMDb's ratings</label>
              </div>
            </fieldset>
          )}

          <div className="toolbar">
            <span className="hint push-right">
              {MEDIA_TYPES.map((m) => `${totals[m]} ${typePluralLabel(m).toLowerCase()}`).join(", ")} will be added or updated. Everything stays private.
            </span>
            <button className="btn ghost" disabled={busy !== null} onClick={() => setPreview(null)}>Cancel</button>
            <button className="btn primary" disabled={busy !== null || totals.movie + totals.tv + totals.anime === 0} onClick={runImport}>
              {busy === "import" ? "Importing…" : `Import ${plural(totals.movie + totals.tv + totals.anime, "title", "titles")}`}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

