"use client";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EpisodeView, SegmentView } from "@/lib/domain/types";
import { activePointer, allEpisodes, computeProgress, episodeAverage, episodeCode, orderedSegments, sortedEpisodes } from "@/lib/domain/progress";
import { RATING_BANDS, RATING_STEPS, formatScore, ratingBand } from "@/lib/domain/rating";
import { resolveAssessment, type AssessmentPatch } from "@/lib/domain/assessment";
import type { BulkAssessAction } from "@/lib/schemas";
import { api } from "@/lib/client/api";
import { useToast } from "./Toasts";
import { ProgressBar } from "./ProgressBar";

type OpenEditor = { segId: number; epId: number; rect: DOMRect };
type OnOpen = (seg: SegmentView, ep: EpisodeView, el: HTMLElement) => void;

function cellText(e: EpisodeView) {
  if (e.rating != null) return formatScore(e.rating);
  return e.state === "watched" ? "✓" : e.state === "skipped" ? "N/A" : "?";
}

function cellLabel(seg: SegmentView, e: EpisodeView) {
  const state = e.rating != null ? `rated ${e.rating} of 5` : e.state === "watched" ? "watched, not rated" : e.state === "skipped" ? "skipped (N/A)" : "not watched";
  return [episodeCode(seg, e), e.title, state, e.filler && "filler"].filter(Boolean).join(", ");
}

/** One heatmap cell. Memoised so a save re-renders only the cell that changed. */
const EpisodeCell = memo(function EpisodeCell({ seg, ep, isNext, busy, onOpen }: { seg: SegmentView; ep: EpisodeView; isNext: boolean; busy: boolean; onOpen: OnOpen }) {
  const label = cellLabel(seg, ep);
  const band = ep.rating != null ? ratingBand(ep.rating).key : ep.state;
  return (
    <button
      id={`ep-${ep.id}`}
      className={["cell", band, ep.filler && "filler", isNext && "next", busy && "busy"].filter(Boolean).join(" ")}
      aria-label={label}
      title={label}
      onClick={(ev) => onOpen(seg, ep, ev.currentTarget)}
    >
      {cellText(ep)}
    </button>
  );
});

export function Heatmap({ mediaId, initial, initialSegment }: { mediaId: number; initial: SegmentView[]; initialSegment?: number | null }) {
  const [segments, setSegments] = useState(initial);
  const [view, setView] = useState<"grid" | number>(initialSegment && initial.some((s) => s.id === initialSegment) ? initialSegment : "grid");
  const [open, setOpen] = useState<OpenEditor | null>(null);
  const [busy, setBusy] = useState<ReadonlySet<number>>(new Set());
  const toast = useToast();

  const { ordered, progress, pointer, avg, maxCols } = useMemo(() => {
    const ordered = orderedSegments(segments);
    const eps = allEpisodes(segments);
    return {
      ordered,
      progress: computeProgress(eps),
      pointer: activePointer(segments),
      avg: episodeAverage(eps),
      maxCols: Math.max(0, ...ordered.map((s) => s.episodes.length)),
    };
  }, [segments]);
  const nextId = pointer.nextEpisode?.id;

  useEffect(() => {
    // Scroll to the targeted episode (from the Currently Watching strip).
    const id = window.location.hash.slice(1);
    if (id) document.getElementById(id)?.scrollIntoView({ block: "center", inline: "center" });
  }, []);

  const updateEp = (segId: number, epId: number, fn: (e: EpisodeView) => EpisodeView) =>
    setSegments((ss) => ss.map((s) => (s.id !== segId ? s : { ...s, episodes: s.episodes.map((e) => (e.id === epId ? fn(e) : e)) })));

  const setBusyFor = (id: number, on: boolean) =>
    setBusy((b) => {
      const n = new Set(b);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });

  const save = async (ep: EpisodeView, patch: AssessmentPatch) => {
    updateEp(ep.segmentId, ep.id, (e) => ({ ...e, ...resolveAssessment(e, patch) }));
    setBusyFor(ep.id, true);
    try {
      const r = await api<{ episode: EpisodeView }>(`/api/media/${mediaId}/episodes/${ep.id}`, { method: "PATCH", body: patch });
      updateEp(ep.segmentId, ep.id, () => r.episode);
    } catch (e) {
      updateEp(ep.segmentId, ep.id, () => ep); // roll back: never show an unsaved rating as saved
      toast.push("error", `Not saved: ${(e as Error).message}`);
    } finally {
      setBusyFor(ep.id, false);
    }
  };

  const bulk = async (seg: SegmentView, action: BulkAssessAction, rating?: number) => {
    try {
      const r = await api<{ segments: SegmentView[] }>(`/api/media/${mediaId}/episodes/bulk`, { body: { episodeIds: seg.episodes.map((e) => e.id), action, rating } });
      setSegments(r.segments);
      toast.push("ok", `${seg.label} updated.`);
    } catch (e) {
      toast.push("error", `Not saved: ${(e as Error).message}`);
    }
  };

  const onOpen = useCallback<OnOpen>((seg, ep, el) => setOpen({ segId: seg.id, epId: ep.id, rect: el.getBoundingClientRect() }), []);
  const onClose = useCallback(() => {
    setOpen((o) => {
      if (o) requestAnimationFrame(() => document.getElementById(`ep-${o.epId}`)?.focus());
      return null;
    });
  }, []);

  if (!segments.length) {
    return (
      <div className="empty-state">
        <p>No seasons yet. Add seasons, cours or specials in Studio to start rating episodes.</p>
        <a className="btn" href={`/studio/${mediaId}#structure`}>Edit structure</a>
      </div>
    );
  }

  const openSeg = open && segments.find((s) => s.id === open.segId);
  const openEp = openSeg && openSeg.episodes.find((e) => e.id === open.epId);
  const cell = (s: SegmentView, e: EpisodeView) => <EpisodeCell seg={s} ep={e} isNext={nextId === e.id} busy={busy.has(e.id)} onOpen={onOpen} />;
  const current = view === "grid" ? null : ordered.find((x) => x.id === view);

  return (
    <div className="stack">
      <ProgressBar p={progress} big />
      <div className="stat-row">
        <div className="stat"><span className="v">{avg != null ? avg.toFixed(2) : "–"}</span><span className="k">Episode average (calculated)</span></div>
        <div className="stat"><span className="v">{progress.rated}</span><span className="k">Episodes rated</span></div>
        <div className="stat">
          <span className="v">{pointer.nextEpisode && pointer.segment ? episodeCode(pointer.segment, pointer.nextEpisode) : pointer.caughtUp ? "Caught up" : "–"}</span>
          <span className="k">Up next</span>
        </div>
      </div>

      <div className="segment-tabs" role="tablist" aria-label="Seasons">
        <button role="tab" className="chip" aria-selected={view === "grid"} aria-pressed={view === "grid"} onClick={() => setView("grid")}>All seasons</button>
        {ordered.map((s) => (
          <button key={s.id} role="tab" className="chip" aria-selected={view === s.id} aria-pressed={view === s.id} onClick={() => setView(s.id)}>
            {s.label}
          </button>
        ))}
      </div>

      {current ? (
        <SeasonList seg={current} cell={cell} onBulk={(action, rating) => bulk(current, action, rating)} />
      ) : (
        <div className="heatmap-wrap" tabIndex={0} aria-label="Episode ratings grid. Scroll sideways for more episodes.">
          <table className="heatmap">
            <thead>
              <tr>
                <th scope="col"><span className="visually-hidden">Season</span></th>
                {Array.from({ length: maxCols }, (_, i) => (
                  <th key={i} scope="col">{i + 1}</th>
                ))}
                <th scope="col"><span className="visually-hidden">Average</span></th>
              </tr>
            </thead>
            <tbody>
              {ordered.map((s, idx) => {
                const prev = ordered[idx - 1];
                const sameSeason = prev && s.seasonNumber != null && prev.seasonNumber === s.seasonNumber;
                const segAvg = episodeAverage(s.episodes);
                return (
                  <tr key={s.id} id={`seg-${s.id}`} className={idx > 0 && !sameSeason ? "sep" : undefined}>
                    <th scope="row" className="row-h">{s.label}</th>
                    {sortedEpisodes(s).map((e) => (
                      <td key={e.id}>{cell(s, e)}</td>
                    ))}
                    {Array.from({ length: maxCols - s.episodes.length }, (_, i) => (
                      <td key={`pad${i}`} className="pad" aria-hidden="true" />
                    ))}
                    <td className="avg-cell">{segAvg != null ? `avg ${segAvg.toFixed(2)}` : ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Legend />

      {openSeg && openEp && (
        <EpisodeEditor
          seg={openSeg}
          ep={openEp}
          rect={open.rect}
          onClose={onClose}
          onSave={(p, close) => {
            save(openEp, p);
            if (close) onClose();
          }}
        />
      )}
    </div>
  );
}

/** Single-season view: episode titles plus season-wide quick actions. */
function SeasonList({ seg, cell, onBulk }: { seg: SegmentView; cell: (s: SegmentView, e: EpisodeView) => React.ReactNode; onBulk: (action: BulkAssessAction, rating?: number) => void }) {
  const p = computeProgress(seg.episodes);
  const avg = episodeAverage(seg.episodes);
  return (
    <div className="stack tight" id={`seg-${seg.id}`}>
      <div className="toolbar">
        <span className="hint push-right">
          {p.watched}/{p.denominator} watched{avg != null ? ` · average ${avg.toFixed(2)}` : ""}
        </span>
        <button className="btn small" onClick={() => onBulk("watched")}>Mark all watched</button>
        <QuickRate onRate={(r) => onBulk("rate_unrated", r)} />
        <button className="btn small" onClick={() => onBulk("skipped")}>Skip season</button>
        <button className="btn small ghost" onClick={() => confirm(`Reset every episode in ${seg.label} to not watched? Ratings in this season will be cleared.`) && onBulk("unwatched")}>
          Reset
        </button>
      </div>
      <div className="ep-list">
        {sortedEpisodes(seg).map((e) => (
          <div className="ep-row" key={e.id}>
            {cell(seg, e)}
            <div className="t">
              <strong>{e.number}. {e.title ?? `Episode ${e.number}`}</strong>
              <span>{[e.airDate, e.filler && "Filler", e.state === "skipped" && "Skipped"].filter(Boolean).join(" · ")}</span>
            </div>
            <span className="hint">{episodeCode(seg, e)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function QuickRate({ onRate }: { onRate: (r: number) => void }) {
  const [v, setV] = useState("");
  return (
    <span className="toolbar" style={{ gap: 4 }}>
      <label>
        <span className="visually-hidden">Rating for unrated episodes</span>
        <select className="select small" value={v} onChange={(e) => setV(e.target.value)}>
          <option value="">Rate unrated…</option>
          {RATING_STEPS.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
      </label>
      <button className="btn small" disabled={!v} onClick={() => { onRate(Number(v)); setV(""); }}>Apply</button>
    </span>
  );
}

function EpisodeEditor({ seg, ep, rect, onClose, onSave }: { seg: SegmentView; ep: EpisodeView; rect: DOMRect; onClose: () => void; onSave: (p: AssessmentPatch, close: boolean) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>("button[aria-pressed='true'], .rate-grid button")?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && onClose();
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [onClose]);
  const width = Math.min(360, window.innerWidth - 24);
  const left = Math.max(12, Math.min(rect.left + rect.width / 2 - width / 2, window.innerWidth - width - 12));
  const style: React.CSSProperties = rect.bottom + 330 < window.innerHeight ? { left, top: rect.bottom + 8 } : { left, bottom: window.innerHeight - rect.top + 8 };
  const choice = (label: string, pressed: boolean, patch: AssessmentPatch) => (
    <button className="btn small" aria-pressed={pressed} onClick={() => onSave(patch, true)}>{label}</button>
  );
  return (
    <div className="pop" ref={ref} style={style} role="dialog" aria-label={`Edit ${episodeCode(seg, ep)}`}>
      <div>
        <h3>{episodeCode(seg, ep)}{ep.title ? `: ${ep.title}` : ""}</h3>
        <p className="hint">{seg.label}{ep.airDate ? ` · aired ${ep.airDate}` : ""}</p>
      </div>
      <div className="rate-grid" role="group" aria-label="Rating">
        {RATING_STEPS.map((r) => (
          <button key={r} className={`cell ${ratingBand(r).key}`} aria-pressed={ep.rating === r} aria-label={`${r} stars`} onClick={() => onSave({ rating: r }, true)}>
            {formatScore(r)}
          </button>
        ))}
      </div>
      <div className="pop-actions">
        {choice("Watched, no rating", ep.state === "watched" && ep.rating == null, { state: "watched", rating: null })}
        {choice("Skip (N/A)", ep.state === "skipped", { state: "skipped" })}
        {choice("Not watched", ep.state === "unwatched", { state: "unwatched" })}
      </div>
      <label className="check">
        <input type="checkbox" checked={ep.filler} onChange={(e) => onSave({ filler: e.target.checked }, false)} />
        Filler episode (keeps the rating)
      </label>
    </div>
  );
}

function Legend() {
  return (
    <div className="legend" aria-label="Legend">
      {RATING_BANDS.map((b) => (
        <span className="sw" key={b.key}>
          <span className={`cell ${b.key}`} aria-hidden="true">{b.min === 0 ? "1" : formatScore(b.min)}</span>
          {b.label}
        </span>
      ))}
      <span className="sw"><span className="cell watched" aria-hidden="true">✓</span>Watched, no rating</span>
      <span className="sw"><span className="cell unwatched" aria-hidden="true">?</span>Not watched yet</span>
      <span className="sw"><span className="cell skipped" aria-hidden="true">N/A</span>Skipped on purpose</span>
      <span className="sw"><span className="cell unwatched filler" aria-hidden="true">?</span>Filler (any state)</span>
      <span className="sw"><span className="blank" aria-hidden="true" />Blank: no such episode</span>
    </div>
  );
}
