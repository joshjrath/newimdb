"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import { useAction } from "../useAction";
import { plural } from "@/lib/domain/text";
import { GENRE_PRESETS, describeRules, norm } from "@/lib/domain/genres";
import type { GenreState } from "@/lib/genres/state";

const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

/**
 * Settings → Genres: the few genre filters you want. Adding one tags every movie, show and
 * anime that fits, straight away; new titles are tagged as they arrive.
 */
export function GenreSettings({ initial }: { initial: GenreState }) {
  const [st, setSt] = useState(initial);
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<{ id: number; name: string; genres: string; allGenres: string; keywords: string; titles: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const { busy, run } = useAction();
  const have = new Set(st.genres.map((g) => norm(g.name)));
  const presets = GENRE_PRESETS.filter((p) => !have.has(norm(p.name)));
  const job = st.keywords.job;

  const refresh = useCallback(async () => {
    try {
      setSt(await api<GenreState>("/api/genres"));
    } catch {}
  }, []);
  useEffect(() => {
    if (job?.state !== "running") return;
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, [job?.state, refresh]);

  const add = async (n: string) => {
    n = n.trim();
    if (!n) return;
    const r = await run(() => api<GenreState & { tagged: number }>("/api/genres", { body: { name: n } }), {
      ok: (x) => `Added ${n}: ${plural(x.tagged, "title", "titles")} tagged.`,
    });
    if (r) {
      setSt(r);
      setName("");
    }
  };

  const save = async () => {
    if (!editing) return;
    const body = { name: editing.name, rules: { genres: list(editing.genres), allGenres: list(editing.allGenres), keywords: list(editing.keywords), titles: list(editing.titles) } };
    const r = await run(() => api<GenreState & { tagged: number }>(`/api/genres/${editing.id}`, { method: "PATCH", body }), { ok: "Saved and re-tagged." });
    if (r) {
      setSt(r);
      setEditing(null);
    }
  };

  const remove = async (id: number, n: string) => {
    const r = await run(() => api<GenreState>(`/api/genres/${id}`, { method: "DELETE" }), { ok: `Removed ${n}.` });
    if (r) setSt(r);
    setConfirmDelete(null);
  };

  const fetchKeywords = async () => {
    const r = await run(() => api<GenreState>("/api/genres/keywords", { body: {} }));
    if (r) setSt(r);
  };

  return (
    <section className="panel" aria-labelledby="genres-h">
      <header>
        <h2 id="genres-h">Genres</h2>
        <span className="hint">Only the ones you add show up as filters. Each one tags your whole library automatically.</span>
      </header>

      <form
        className="toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          add(name);
        }}
      >
        <label className="grow" htmlFor="genre-name">
          <span className="visually-hidden">Genre name</span>
          <input id="genre-name" className="input" value={name} maxLength={40} placeholder="Add a genre, e.g. Superhero" onChange={(e) => setName(e.target.value)} />
        </label>
        <button className="btn primary" disabled={busy || !name.trim()}>Add genre</button>
      </form>

      {presets.length > 0 && (
        <div className="chips" aria-label="Suggested genres">
          <span className="label" style={{ alignSelf: "center", marginRight: 2 }}>Suggestions</span>
          {presets.map((p) => (
            <button key={p.name} type="button" className="chip" disabled={busy} title={describeRules(p.rules)} onClick={() => add(p.name)}>
              + {p.name}
            </button>
          ))}
        </div>
      )}

      {st.genres.length === 0 ? (
        <p className="hint">No genres yet. Pick a suggestion or type your own.</p>
      ) : (
        <ul className="people-list">
          {st.genres.map((g) => (
            <li key={g.id}>
              {editing?.id === g.id ? (
                <form
                  className="genre-edit grow-row"
                  onSubmit={(e) => {
                    e.preventDefault();
                    save();
                  }}
                >
                  <label>
                    <span className="label">Name</span>
                    <input className="input" autoFocus value={editing.name} maxLength={40} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
                  </label>
                  <label>
                    <span className="label">Any of these genres</span>
                    <input className="input" value={editing.genres} placeholder="Action, Adventure" onChange={(e) => setEditing({ ...editing, genres: e.target.value })} />
                  </label>
                  <label>
                    <span className="label">All of these genres</span>
                    <input className="input" value={editing.allGenres} placeholder="Documentary, Crime" onChange={(e) => setEditing({ ...editing, allGenres: e.target.value })} />
                  </label>
                  <label>
                    <span className="label">Any of these TMDB keywords</span>
                    <input className="input" value={editing.keywords} placeholder="superhero, heist" onChange={(e) => setEditing({ ...editing, keywords: e.target.value })} />
                  </label>
                  <label>
                    <span className="label">Title contains any of</span>
                    <input className="input" value={editing.titles} placeholder="Spider-Man, Batman" onChange={(e) => setEditing({ ...editing, titles: e.target.value })} />
                  </label>
                  <div className="toolbar">
                    <button className="btn small primary" disabled={busy || !editing.name.trim()}>Save</button>
                    <button type="button" className="btn small ghost" onClick={() => setEditing(null)}>Cancel</button>
                  </div>
                </form>
              ) : confirmDelete === g.id ? (
                <div className="toolbar grow-row">
                  <span className="push-right">
                    Remove the <b>{g.name}</b> filter? Your titles stay as they are.
                  </span>
                  <button className="btn small danger" disabled={busy} onClick={() => remove(g.id, g.name)}>Remove</button>
                  <button className="btn small ghost" onClick={() => setConfirmDelete(null)}>Keep</button>
                </div>
              ) : (
                <>
                  <span className="genre-name">
                    <span className="person-name">{g.name}</span>
                    <span className="hint">{describeRules(g.rules)}</span>
                  </span>
                  {g.count > 0 ? (
                    <Link className="hint person-count" href={`/studio?genre=${g.id}`}>{plural(g.count, "title", "titles")}</Link>
                  ) : (
                    <span className="hint person-count">No titles yet</span>
                  )}
                  <button
                    className="btn small ghost"
                    onClick={() =>
                      setEditing({ id: g.id, name: g.name, genres: (g.rules.genres ?? []).join(", "), allGenres: (g.rules.allGenres ?? []).join(", "), keywords: (g.rules.keywords ?? []).join(", "), titles: (g.rules.titles ?? []).join(", ") })
                    }
                  >
                    Edit
                  </button>
                  <button className="btn small ghost" onClick={() => setConfirmDelete(g.id)}>Remove</button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {st.genres.some((g) => g.needsKeywords) && (
        <div className="stack tight">
          {!st.keywords.tmdb ? (
            <p className="hint">Keyword-based genres (like Superhero or Heist) need a TMDB key to find keywords; until then they only match on genres.</p>
          ) : job?.state === "running" ? (
            <div className="progress" role="status" aria-live="polite">
              <div className="progress-track"><div className="progress-fill" style={{ width: `${job.total ? Math.round((job.done / job.total) * 100) : 0}%` }} /></div>
              <span className="progress-label">Fetching keywords from TMDB: {job.done} of {job.total}</span>
            </div>
          ) : st.keywords.pending > 0 ? (
            <p className="hint">
              {plural(st.keywords.pending, "title doesn't", "titles don't")} have TMDB keywords yet.{" "}
              <button className="btn small" disabled={busy} onClick={fetchKeywords}>Fetch keywords</button>
            </p>
          ) : (
            <p className="hint">Keywords are up to date{job?.failed ? ` (${job.failed} couldn't be fetched; they'll be retried)` : ""}.</p>
          )}
        </div>
      )}
    </section>
  );
}
