"use client";
import { useMemo, useState } from "react";
import type { MediaType, SegmentView } from "@/lib/domain/types";
import { EPISODE_VIEWS, buildEpisodeView, foldBack, mainRun, type Arc, type EpisodeViewKey } from "@/lib/domain/episodeViews";
import { api } from "@/lib/client/api";
import { useAction } from "./useAction";
import { Heatmap } from "./Heatmap";
import { StructureEditor } from "./studio/StructureEditor";

/**
 * Episodes on a show's page: the rating grid, with its seasons editable right here.
 * Anime (and any show with films or OVAs) can switch how episodes are grouped: story
 * order, release order, seasons, cours, arcs, or one long run. The choice is per show.
 */
export function EpisodesSection({ mediaId, type, title, version: v0, initial, initialSegment, initialView = "story", initialArcs = [] }: {
  mediaId: number;
  type: MediaType;
  title?: string;
  version: number;
  initial: SegmentView[];
  initialSegment: number | null;
  initialView?: EpisodeViewKey;
  initialArcs?: Arc[];
}) {
  const [segments, setSegments] = useState(initial);
  const [version, setVersion] = useState(v0);
  const [editing, setEditing] = useState(initial.length === 0);
  const [view, setView] = useState<EpisodeViewKey>(initialView);
  const [arcs, setArcs] = useState(initialArcs);
  const [arcForm, setArcForm] = useState({ name: "", first: "", last: "" });
  // A structure save, view change or arc change rebuilds the grid, so remount it.
  const [gridKey, setGridKey] = useState(0);
  const { busy, run } = useAction();

  const hasExtras = segments.some((s) => s.kind !== "season" && s.kind !== "cour");
  const offerViews = type === "anime" || hasExtras;
  const runLength = useMemo(() => mainRun(segments).length, [segments]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const shown = useMemo(() => (offerViews ? buildEpisodeView(segments, view, arcs) : segments), [gridKey, view, arcs, offerViews]);

  const pick = async (v: EpisodeViewKey) => {
    setView(v);
    setGridKey((k) => k + 1);
    await api(`/api/media/${mediaId}/view`, { method: "PATCH", body: { view: v } }).catch(() => {});
  };
  const addArc = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await run(() => api<{ arcs: Arc[] }>(`/api/media/${mediaId}/arcs`, { body: { name: arcForm.name, firstEp: Number(arcForm.first), lastEp: Number(arcForm.last) } }), { ok: `Added the ${arcForm.name.trim()} arc.` });
    if (r) {
      setArcs(r.arcs);
      setArcForm({ name: "", first: arcForm.last ? String(Number(arcForm.last) + 1) : "", last: "" });
      setGridKey((k) => k + 1);
    }
  };
  const removeArc = async (a: Arc) => {
    const r = await run(() => api<{ arcs: Arc[] }>(`/api/media/${mediaId}/arcs`, { method: "DELETE", body: { arcId: a.id } }), { ok: `Removed ${a.name}.` });
    if (r) {
      setArcs(r.arcs);
      setGridKey((k) => k + 1);
    }
  };

  return (
    <section className="panel" aria-labelledby="eps-h">
      <div className="episodes-head">
        <h2 id="eps-h">Episodes</h2>
        <button type="button" className="btn small" aria-expanded={editing} onClick={() => setEditing((e) => !e)}>
          {editing ? "Done editing seasons" : "Edit seasons"}
        </button>
      </div>
      {offerViews && (
        <div className="chips view-chips" role="tablist" aria-label="Group episodes by">
          {EPISODE_VIEWS.map((v) => (
            <button key={v.key} type="button" role="tab" className="chip" aria-selected={view === v.key} aria-pressed={view === v.key} title={v.hint} onClick={() => pick(v.key)}>
              {v.label}
            </button>
          ))}
        </div>
      )}
      {offerViews && view === "arcs" && (
        <div className="arc-editor">
          {arcs.length > 0 && (
            <ul className="chips" aria-label="Your arcs">
              {arcs.map((a) => (
                <li key={a.id} className="chip">
                  {a.name} <span className="hint">{a.firstEp}–{a.lastEp}</span>
                  <button type="button" className="chip-x" disabled={busy} onClick={() => removeArc(a)} aria-label={`Remove ${a.name}`}>×</button>
                </li>
              ))}
            </ul>
          )}
          <form className="toolbar" onSubmit={addArc}>
            <input className="input small grow" value={arcForm.name} maxLength={80} placeholder="Arc name, e.g. Soul Society" onChange={(e) => setArcForm({ ...arcForm, name: e.target.value })} aria-label="Arc name" />
            <input className="input small num" type="number" min={1} max={runLength} value={arcForm.first} placeholder="From ep" onChange={(e) => setArcForm({ ...arcForm, first: e.target.value })} aria-label="First episode" />
            <input className="input small num" type="number" min={1} max={runLength} value={arcForm.last} placeholder="To ep" onChange={(e) => setArcForm({ ...arcForm, last: e.target.value })} aria-label="Last episode" />
            <button className="btn small primary" disabled={busy || !arcForm.name.trim() || !arcForm.first || !arcForm.last}>Add arc</button>
          </form>
          <p className="hint">Episodes are numbered 1–{runLength} across all seasons. Filler runs between your arcs are grouped by themselves.</p>
        </div>
      )}
      {editing && (
        <StructureEditor
          mediaId={mediaId}
          type={type}
          segments={segments}
          version={version}
          onChange={(segs, v) => {
            setSegments(segs);
            if (v != null) setVersion(v);
            setGridKey((k) => k + 1);
          }}
          onDirty={() => {}}
        />
      )}
      <p className="hint">Your overall rating above is set by you. The episode average below is calculated and shown separately.</p>
      <Heatmap
        key={`${gridKey}-${view}`}
        mediaId={mediaId}
        ignoreFiller={type === "anime"}
        title={title}
        initial={shown}
        initialSegment={view === "story" || view === "seasons" || view === "release" ? initialSegment : null}
        onSegments={(updated) => setSegments((real) => (offerViews ? foldBack(real, updated) : updated))}
      />
    </section>
  );
}
