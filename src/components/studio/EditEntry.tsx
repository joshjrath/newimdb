"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/client/api";
import { useToast } from "../Toasts";
import { Poster } from "../Poster";
import { StarInput } from "../StarInput";
import { useUnsavedGuard } from "./useUnsavedGuard";
import { StructureEditor } from "./StructureEditor";
import { EpisodeTextPanel } from "./EpisodeTextPanel";
import { SaveState } from "./SaveState";
import { StatusOptions } from "../Options";
import { TYPE_LABEL, type MediaDetail, type MediaView, type SegmentView } from "@/lib/domain/types";
import { suggestedLabel } from "@/lib/domain/rating";
import { mediaHref } from "@/lib/domain/links";
import { wordCount } from "@/lib/domain/text";

type Draft = {
  title: string; originalTitle: string; year: string; overview: string; posterUrl: string; backdropUrl: string; runtimeMin: string;
  genres: string; tmdbId: string; imdbId: string; malId: string; tvmazeId: string; anilistId: string; letterboxdUrl: string;
  lockedFields: string[];
  rating: number | null; ratingLabel: string; body: string; watchedOn: string; spoiler: boolean; status: string; featured: boolean;
  tags: string;
};

function toDraft(m: MediaView): Draft {
  const s = (v: unknown) => (v == null ? "" : String(v));
  return {
    title: m.title, originalTitle: s(m.originalTitle), year: s(m.year), overview: s(m.overview), posterUrl: s(m.posterUrl),
    backdropUrl: s(m.backdropUrl), runtimeMin: s(m.runtimeMin), genres: m.genres.join(", "), tmdbId: s(m.tmdbId), imdbId: s(m.imdbId),
    malId: s(m.malId), tvmazeId: s(m.tvmazeId), anilistId: s(m.anilistId), letterboxdUrl: s(m.letterboxdUrl), lockedFields: m.lockedFields,
    rating: m.review.rating, ratingLabel: s(m.review.ratingLabel), body: m.review.body, watchedOn: s(m.review.watchedOn),
    spoiler: m.review.spoiler, status: s(m.review.status), featured: m.review.featured, tags: m.tags.join(", "),
  };
}

const num = (v: string) => (v.trim() === "" ? null : Number(v));
const txt = (v: string) => (v.trim() === "" ? null : v.trim());

function toPatch(d: Draft, version: number) {
  return {
    version,
    metadata: {
      title: d.title.trim(), originalTitle: txt(d.originalTitle), year: num(d.year), overview: txt(d.overview), posterUrl: txt(d.posterUrl),
      backdropUrl: txt(d.backdropUrl), runtimeMin: num(d.runtimeMin), genres: d.genres.split(",").map((g) => g.trim()).filter(Boolean),
      tmdbId: num(d.tmdbId), imdbId: txt(d.imdbId), malId: num(d.malId), tvmazeId: num(d.tvmazeId), anilistId: num(d.anilistId),
      letterboxdUrl: txt(d.letterboxdUrl), lockedFields: d.lockedFields,
    },
    review: {
      rating: d.rating, ratingLabel: txt(d.ratingLabel), body: d.body.replace(/\r\n?/g, "\n"), watchedOn: txt(d.watchedOn),
      spoiler: d.spoiler, status: (txt(d.status) as never) ?? null, featured: d.featured, visibility: "private" as const,
    },
    tags: d.tags.split(",").map((t) => t.trim()).filter(Boolean),
  };
}

const LOCKABLE: [keyof Draft, string][] = [["title", "Title"], ["year", "Year"], ["overview", "Overview"], ["posterUrl", "Poster"], ["genres", "Genres"]];

export function EditEntry({ initial }: { initial: MediaDetail }) {
  const router = useRouter();
  const toast = useToast();
  const { id, type } = initial;
  const [version, setVersion] = useState(initial.version);
  const [saved, setSaved] = useState(() => toDraft(initial));
  const [draft, setDraft] = useState(() => toDraft(initial));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [structureDirty, setStructureDirty] = useState(false);
  const [segments, setSegments] = useState<SegmentView[]>(initial.segments);
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(saved), [draft, saved]);
  useUnsavedGuard(dirty || structureDirty);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const save = useCallback(async () => {
    if (!draft.title.trim()) {
      setError("Title is required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const r = await api<{ media: MediaView }>(`/api/media/${id}`, { method: "PATCH", body: toPatch(draft, version) });
      setVersion(r.media.version);
      const d = toDraft(r.media);
      setSaved(d);
      setDraft(d);
      toast.push("ok", "Saved.");
    } catch (e) {
      const msg = (e as Error).message;
      setError(msg);
      toast.push("error", `Not saved: ${msg}`);
    } finally {
      setSaving(false);
    }
  }, [draft, version, id, toast]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        if (dirty && !saving) save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dirty, saving, save]);

  const upload = async (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    try {
      const { url } = await api<{ url: string }>("/api/uploads", { body: fd });
      set("posterUrl", url);
      toast.push("ok", "Poster uploaded. Save to keep it.");
    } catch (e) {
      toast.push("error", (e as Error).message);
    }
  };

  const refresh = async () => {
    if (dirty && !confirm("Refreshing replaces unsaved metadata edits in this form. Continue?")) return;
    try {
      const r = await api<{ media: MediaView; provider: string }>(`/api/media/${id}/refresh`, { body: {} });
      setVersion(r.media.version);
      const fresh = toDraft(r.media);
      setSaved(fresh);
      // Keep unsaved review edits; metadata comes from the refresh.
      setDraft(dirty ? { ...fresh, body: draft.body, rating: draft.rating } : fresh);
      toast.push("ok", `Details refreshed from ${r.provider}. Locked fields, your review and ratings were left alone.`);
    } catch (e) {
      toast.push("error", (e as Error).message);
    }
  };

  const del = async () => {
    if (prompt(`Delete "${saved.title}" with its review and all episode ratings? Type DELETE to confirm.`) !== "DELETE") return;
    try {
      await api(`/api/media/${id}`, { method: "DELETE" });
      toast.push("ok", "Deleted.");
      router.push("/studio");
    } catch (e) {
      toast.push("error", (e as Error).message);
    }
  };

  const viewHref = mediaHref({ id, type, title: saved.title });
  const words = wordCount(draft.body);
  const isLocked = (k: string) => draft.lockedFields.includes(k);

  return (
    <div className="stack loose">
      <div className="page-head">
        <div>
          <p className="hint"><Link href="/studio">Studio</Link> · {TYPE_LABEL[type]}</p>
          <h1>{saved.title}</h1>
        </div>
        <div className="toolbar">
          <Link className="btn" href={viewHref}>View</Link>
        </div>
      </div>

      <div className="studio-grid two">
        <section className="panel" aria-labelledby="rev-h">
          <header><h2 id="rev-h">Review</h2><span className="hint">Private</span></header>
          <div className="field">
            <span className="label">My rating</span>
            <StarInput value={draft.rating} onChange={(v) => set("rating", v)} label="My overall rating" />
            <span className="hint">Set by you. It is never replaced by the episode average.</span>
          </div>
          <div className="form-grid">
            <label className="field">
              <span>Rating label (optional)</span>
              <input className="input" value={draft.ratingLabel} maxLength={40} placeholder={suggestedLabel(draft.rating) ?? "e.g. Perfect"} onChange={(e) => set("ratingLabel", e.target.value)} />
              {draft.rating != null && !draft.ratingLabel && suggestedLabel(draft.rating) && (
                <button type="button" className="btn small ghost self-start" onClick={() => set("ratingLabel", suggestedLabel(draft.rating)!)}>
                  Use “{suggestedLabel(draft.rating)}”
                </button>
              )}
            </label>
            <label className="field">
              <span>Status</span>
              <select className="select" value={draft.status} onChange={(e) => set("status", e.target.value)}>
                <option value="">None</option>
                <StatusOptions />
              </select>
            </label>
            <label className="field">
              <span>{type === "movie" ? "Date watched" : "Date finished / last watched"}</span>
              <input className="input" type="date" value={draft.watchedOn} onChange={(e) => set("watchedOn", e.target.value)} />
            </label>
          </div>
          <label className="field">
            <span>Review</span>
            <textarea className="textarea" value={draft.body} onChange={(e) => set("body", e.target.value)} placeholder="What did you think? Leave a blank line between paragraphs." />
            <span className="hint">{words} {words === 1 ? "word" : "words"}{words > 0 && words < 50 ? " · cards look best around 50–75 words, but any length works" : ""}</span>
          </label>
          <div className="toolbar" style={{ gap: 20 }}>
            <label className="check"><input type="checkbox" checked={draft.spoiler} onChange={(e) => set("spoiler", e.target.checked)} /> Contains spoilers</label>
            <label className="check"><input type="checkbox" checked={draft.featured} onChange={(e) => set("featured", e.target.checked)} /> Featured</label>
          </div>
          <label className="field">
            <span>Tags</span>
            <input className="input" value={draft.tags} onChange={(e) => set("tags", e.target.value)} placeholder="e.g. MCU, True Crime, Sitcom" />
            <span className="hint">Comma separated. Tags become filters in the library.</span>
          </label>
          <div className="notice">
            Visibility: <strong>Private</strong>. Publishing and public sharing are switched off in this version.
          </div>
        </section>

        <aside className="panel" aria-labelledby="poster-h">
          <header><h2 id="poster-h">Poster</h2></header>
          <div style={{ maxWidth: 220 }}><Poster url={draft.posterUrl || null} title={draft.title || saved.title} contain /></div>
          <label className="field">
            <span>Image URL</span>
            <input className="input" value={draft.posterUrl} onChange={(e) => set("posterUrl", e.target.value)} />
          </label>
          <label className="btn self-start">
            Upload image
            <input type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif" className="visually-hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          </label>
        </aside>
      </div>

      <section className="panel" aria-labelledby="meta-h">
        <header>
          <h2 id="meta-h">Details</h2>
          <button type="button" className="btn small" onClick={refresh}>Refresh from provider</button>
        </header>
        <div className="form-grid">
          <label className="field"><span>Title</span><input className="input" value={draft.title} onChange={(e) => set("title", e.target.value)} required /></label>
          <label className="field"><span>Original title</span><input className="input" value={draft.originalTitle} onChange={(e) => set("originalTitle", e.target.value)} /></label>
          <label className="field"><span>Year</span><input className="input" inputMode="numeric" value={draft.year} onChange={(e) => set("year", e.target.value)} /></label>
          <label className="field"><span>Runtime (min)</span><input className="input" inputMode="numeric" value={draft.runtimeMin} onChange={(e) => set("runtimeMin", e.target.value)} /></label>
          <label className="field wide"><span>Genres</span><input className="input" value={draft.genres} onChange={(e) => set("genres", e.target.value)} /></label>
          <label className="field wide"><span>Overview</span><textarea className="textarea" style={{ minHeight: 90, fontSize: "0.98rem" }} value={draft.overview} onChange={(e) => set("overview", e.target.value)} /></label>
          <label className="field"><span>IMDb ID</span><input className="input" value={draft.imdbId} placeholder="tt0903747" onChange={(e) => set("imdbId", e.target.value)} /></label>
          {type !== "anime" && <label className="field"><span>TMDB ID</span><input className="input" inputMode="numeric" value={draft.tmdbId} onChange={(e) => set("tmdbId", e.target.value)} /></label>}
          {type === "tv" && <label className="field"><span>TVmaze ID</span><input className="input" inputMode="numeric" value={draft.tvmazeId} onChange={(e) => set("tvmazeId", e.target.value)} /></label>}
          {type === "anime" && <label className="field"><span>MyAnimeList ID</span><input className="input" inputMode="numeric" value={draft.malId} onChange={(e) => set("malId", e.target.value)} /></label>}
          {type === "anime" && <label className="field"><span>AniList ID</span><input className="input" inputMode="numeric" value={draft.anilistId} onChange={(e) => set("anilistId", e.target.value)} /></label>}
          {type === "movie" && <label className="field"><span>Letterboxd URL</span><input className="input" value={draft.letterboxdUrl} onChange={(e) => set("letterboxdUrl", e.target.value)} /></label>}
        </div>
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="label" style={{ marginBottom: 6 }}>Keep my version when refreshing</legend>
          <div className="toolbar" style={{ gap: 16 }}>
            {LOCKABLE.map(([k, label]) => (
              <label key={k} className="check">
                <input
                  type="checkbox"
                  checked={isLocked(k)}
                  onChange={(e) => set("lockedFields", e.target.checked ? [...draft.lockedFields, k] : draft.lockedFields.filter((x) => x !== k))}
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
      </section>

      <div className="savebar">
        <SaveState error={error} saving={saving} dirty={dirty} />
        {dirty && <button className="btn ghost" onClick={() => { setDraft(saved); setError(null); }}>Discard</button>}
        <button className="btn primary" disabled={!dirty || saving} onClick={save}>Save review and details</button>
      </div>

      {type !== "movie" && (
        <>
          <StructureEditor
            mediaId={id}
            type={type}
            segments={segments}
            version={version}
            onChange={(segs, v) => {
              setSegments(segs);
              if (v != null) setVersion(v);
            }}
            onDirty={setStructureDirty}
          />
          <EpisodeTextPanel mediaId={id} onApplied={setSegments} />
        </>
      )}

      <section className="panel" aria-labelledby="danger-h">
        <header><h2 id="danger-h">Delete</h2></header>
        <p className="hint">Removes this entry, its review and every episode rating. Download a backup first if unsure.</p>
        <div><button className="btn danger" onClick={del}>Delete this entry</button></div>
      </section>
    </div>
  );
}

