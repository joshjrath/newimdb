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
import type { MediaDetail, SegmentView } from "@/lib/domain/types";
import { STATUS_LABEL, TYPE_LABEL, TYPE_TO_CATEGORY, WATCH_STATUSES } from "@/lib/domain/types";
import { suggestedLabel } from "@/lib/domain/rating";
import { slugify, wordCount } from "@/lib/domain/text";

type Draft = {
  title: string; originalTitle: string; year: string; overview: string; posterUrl: string; backdropUrl: string; runtimeMin: string;
  genres: string; tmdbId: string; imdbId: string; malId: string; tvmazeId: string; anilistId: string; letterboxdUrl: string;
  lockedFields: string[];
  rating: number | null; ratingLabel: string; body: string; watchedOn: string; spoiler: boolean; status: string; featured: boolean;
  tags: string;
};

function toDraft(m: MediaDetail): Draft {
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
  const [media, setMedia] = useState(initial);
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
      const r = await api<{ media: MediaDetail }>(`/api/media/${media.id}`, { method: "PATCH", body: toPatch(draft, version) });
      const next = { ...r.media, segments };
      setMedia(next);
      setVersion(r.media.version);
      const d = toDraft(next);
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
  }, [draft, version, media.id, segments, toast]);

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
      const res = await fetch("/api/uploads", { method: "POST", body: fd });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Upload failed");
      set("posterUrl", body.url);
      toast.push("ok", "Poster uploaded. Save to keep it.");
    } catch (e) {
      toast.push("error", (e as Error).message);
    }
  };

  const refresh = async () => {
    if (dirty && !confirm("Refreshing replaces unsaved metadata edits in this form. Continue?")) return;
    try {
      const r = await api<{ media: MediaDetail; provider: string; warnings: string[] }>(`/api/media/${media.id}/refresh`, { body: {} });
      const next = { ...r.media, segments };
      setMedia(next);
      setVersion(r.media.version);
      const d = { ...toDraft(next), body: draft.body, rating: draft.rating };
      setSaved(toDraft(next));
      setDraft(dirty ? d : toDraft(next));
      toast.push("ok", `Details refreshed from ${r.provider}. Locked fields, your review and ratings were left alone.`);
    } catch (e) {
      toast.push("error", (e as Error).message);
    }
  };

  const del = async () => {
    if (prompt(`Delete "${media.title}" with its review and all episode ratings? Type DELETE to confirm.`) !== "DELETE") return;
    try {
      await api(`/api/media/${media.id}`, { method: "DELETE" });
      toast.push("ok", "Deleted.");
      router.push("/studio");
    } catch (e) {
      toast.push("error", (e as Error).message);
    }
  };

  const viewHref = `/watch/${TYPE_TO_CATEGORY[media.type]}/${media.id}-${slugify(saved.title)}`;
  const words = wordCount(draft.body);
  const isLocked = (k: string) => draft.lockedFields.includes(k);

  return (
    <div style={{ display: "grid", gap: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "end", flexWrap: "wrap", marginTop: 24 }}>
        <div>
          <p className="hint"><Link href="/studio">Studio</Link> · {TYPE_LABEL[media.type]}</p>
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
                <button type="button" className="btn small ghost" style={{ justifySelf: "start" }} onClick={() => set("ratingLabel", suggestedLabel(draft.rating)!)}>
                  Use “{suggestedLabel(draft.rating)}”
                </button>
              )}
            </label>
            <label className="field">
              <span>Status</span>
              <select className="select" value={draft.status} onChange={(e) => set("status", e.target.value)}>
                <option value="">None</option>
                {WATCH_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
              </select>
            </label>
            <label className="field">
              <span>{media.type === "movie" ? "Date watched" : "Date finished / last watched"}</span>
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
          <div style={{ maxWidth: 220 }}><Poster url={draft.posterUrl || null} title={draft.title || media.title} contain /></div>
          <label className="field">
            <span>Image URL</span>
            <input className="input" value={draft.posterUrl} onChange={(e) => set("posterUrl", e.target.value)} />
          </label>
          <label className="btn" style={{ justifySelf: "start" }}>
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
          {media.type !== "anime" && <label className="field"><span>TMDB ID</span><input className="input" inputMode="numeric" value={draft.tmdbId} onChange={(e) => set("tmdbId", e.target.value)} /></label>}
          {media.type === "tv" && <label className="field"><span>TVmaze ID</span><input className="input" inputMode="numeric" value={draft.tvmazeId} onChange={(e) => set("tvmazeId", e.target.value)} /></label>}
          {media.type === "anime" && <label className="field"><span>MyAnimeList ID</span><input className="input" inputMode="numeric" value={draft.malId} onChange={(e) => set("malId", e.target.value)} /></label>}
          {media.type === "anime" && <label className="field"><span>AniList ID</span><input className="input" inputMode="numeric" value={draft.anilistId} onChange={(e) => set("anilistId", e.target.value)} /></label>}
          {media.type === "movie" && <label className="field"><span>Letterboxd URL</span><input className="input" value={draft.letterboxdUrl} onChange={(e) => set("letterboxdUrl", e.target.value)} /></label>}
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
        <span className={`state${error ? " err" : dirty ? " dirty" : ""}`} role="status">
          {error ? error : saving ? "Saving…" : dirty ? "Unsaved changes" : "All changes saved"}
        </span>
        {dirty && <button className="btn ghost" onClick={() => { setDraft(saved); setError(null); }}>Discard</button>}
        <button className="btn primary" disabled={!dirty || saving} onClick={save}>Save review and details</button>
      </div>

      {media.type !== "movie" && (
        <>
          <StructureEditor
            mediaId={media.id}
            type={media.type}
            segments={segments}
            version={version}
            onSaved={(segs, v) => {
              setSegments(segs);
              setVersion(v);
            }}
            onSegments={setSegments}
            onDirty={setStructureDirty}
          />
          <EpisodeTextPanel mediaId={media.id} onApplied={setSegments} />
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

