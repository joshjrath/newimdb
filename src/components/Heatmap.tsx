"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EpisodeView, SegmentView } from "@/lib/domain/types";
import { activePointer, allEpisodes, computeProgress, episodeAverage, episodeCode, orderedSegments } from "@/lib/domain/progress";
import { RATING_BANDS, RATING_STEPS, formatScore, ratingBand } from "@/lib/domain/rating";
import { api } from "@/lib/client/api";
import { useToast } from "./Toasts";
import { ProgressBar } from "./ProgressBar";

type Patch = { state?: EpisodeView["state"]; rating?: number | null; filler?: boolean };

function cellClass(e: EpisodeView, isNext: boolean) {
  const base = e.rating != null ? ratingBand(e.rating).key : e.state;
  return `cell ${base}${e.filler ? " filler" : ""}${isNext ? " next" : ""}`;
}
function cellText(e: EpisodeView) {
  if (e.rating != null) return formatScore(e.rating);
  if (e.state === "watched") return "✓";
  if (e.state === "skipped") return "N/A";
  return "?";
}
function cellLabel(seg: SegmentView, e: EpisodeView) {
  const parts = [episodeCode(seg, e)];
  if (e.title) parts.push(e.title);
  parts.push(e.rating != null ? `rated ${e.rating} of 5` : e.state === "watched" ? "watched, not rated" : e.state === "skipped" ? "skipped (N/A)" : "not watched");
  if (e.filler) parts.push("filler");
  return parts.join(", ");
}

/** Apply a patch locally with the same rules as the server (rating ⇒ watched; leaving watched clears rating). */
function applyLocal(e: EpisodeView, p: Patch): EpisodeView {
  let state = p.state ?? e.state;
  let rating = p.rating !== undefined ? p.rating : e.rating;
  if (p.rating != null) state = "watched";
  if (state !== "watched") rating = null;
  return { ...e, state, rating, filler: p.filler ?? e.filler };
}

export function Heatmap({ mediaId, initial, initialSegment }: { mediaId: number; initial: SegmentView[]; initialSegment?: number | null }) {
  const [segments, setSegments] = useState(initial);
  const [view, setView] = useState<"grid" | number>(initialSegment && initial.some((s) => s.id === initialSegment) ? initialSegment : "grid");
  const [open, setOpen] = useState<{ ep: EpisodeView; seg: SegmentView; rect: DOMRect } | null>(null);
  const [busy, setBusy] = useState<Set<number>>(new Set());
  const toast = useToast();
  const ordered = useMemo(() => orderedSegments(segments), [segments]);
  const eps = useMemo(() => allEpisodes(segments), [segments]);
  const progress = computeProgress(eps);
  const pointer = activePointer(segments);
  const avg = episodeAverage(eps);
  const maxCols = Math.max(0, ...ordered.map((s) => s.episodes.length));

  useEffect(() => {
    // Scroll to the targeted episode (from the Currently Watching strip).
    const id = window.location.hash.slice(1);
    if (id) document.getElementById(id)?.scrollIntoView({ block: "center", inline: "center" });
  }, []);

  const save = useCallback(
    async (ep: EpisodeView, patch: Patch) => {
      const replaceEp = (x: EpisodeView) => (ss: SegmentView[]) =>
        ss.map((s) => (s.id !== ep.segmentId ? s : { ...s, episodes: s.episodes.map((y) => (y.id === ep.id ? x : y)) }));
      setSegments((ss) => ss.map((s) => (s.id !== ep.segmentId ? s : { ...s, episodes: s.episodes.map((x) => (x.id === ep.id ? applyLocal(x, patch) : x)) })));
      setBusy((b) => new Set(b).add(ep.id));
      try {
        const r = await api<{ segments: SegmentView[] }>(`/api/media/${mediaId}/episodes/${ep.id}`, { method: "PATCH", body: patch });
        setSegments(r.segments);
      } catch (e) {
        setSegments(replaceEp(ep)); // roll back this episode: never show an unsaved rating as saved
        toast.push("error", `Not saved: ${(e as Error).message}`);
      } finally {
        setBusy((b) => {
          const n = new Set(b);
          n.delete(ep.id);
          return n;
        });
      }
    },
    [mediaId, toast],
  );

  const bulk = async (seg: SegmentView, action: string, rating?: number) => {
    const before = segments;
    try {
      const r = await api<{ segments: SegmentView[] }>(`/api/media/${mediaId}/episodes/bulk`, {
        body: { episodeIds: seg.episodes.map((e) => e.id), action, rating },
      });
      setSegments(r.segments);
      toast.push("ok", `${seg.label} updated.`);
    } catch (e) {
      setSegments(before);
      toast.push("error", `Not saved: ${(e as Error).message}`);
    }
  };

  if (!segments.length) {
    return (
      <div className="empty-state">
        <p>No seasons yet. Add seasons, cours or specials in Studio to start rating episodes.</p>
        <a className="btn" href={`/studio/${mediaId}#structure`}>Edit structure</a>
      </div>
    );
  }

  const openFor = (seg: SegmentView, ep: EpisodeView, el: HTMLElement) => setOpen({ seg, ep, rect: el.getBoundingClientRect() });
  const current = open ? segments.find((s) => s.id === open.seg.id)?.episodes.find((e) => e.id === open.ep.id) ?? open.ep : null;

  return (
    <div style={{ display: "grid", gap: 18 }}>
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

      {view === "grid" ? (
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
                const newGroup = idx > 0 && !(prev && s.seasonNumber != null && prev.seasonNumber === s.seasonNumber);
                const segAvg = episodeAverage(s.episodes);
                const sorted = [...s.episodes].sort((a, b) => a.number - b.number);
                return (
                  <tr key={s.id} id={`seg-${s.id}`} className={newGroup ? "sep" : undefined}>
                    <th scope="row" className="row-h">{s.label}</th>
                    {sorted.map((e) => (
                      <td key={e.id}>
                        <button
                          id={`ep-${e.id}`}
                          className={`${cellClass(e, pointer.nextEpisode?.id === e.id)}${busy.has(e.id) ? " busy" : ""}`}
                          aria-label={cellLabel(s, e)}
                          title={cellLabel(s, e)}
                          onClick={(ev) => openFor(s, e, ev.currentTarget)}
                        >
                          {cellText(e)}
                        </button>
                      </td>
                    ))}
                    {Array.from({ length: maxCols - sorted.length }, (_, i) => (
                      <td key={`pad${i}`} className="pad" aria-hidden="true" />
                    ))}
                    <td className="avg-cell">{segAvg != null ? `avg ${segAvg.toFixed(2)}` : ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        (() => {
          const s = ordered.find((x) => x.id === view)!;
          const sorted = [...s.episodes].sort((a, b) => a.number - b.number);
          const segP = computeProgress(s.episodes);
          const segAvg = episodeAverage(s.episodes);
          return (
            <div style={{ display: "grid", gap: 12 }} id={`seg-${s.id}`}>
              <div className="toolbar">
                <span className="hint" style={{ marginRight: "auto" }}>
                  {segP.watched}/{segP.denominator} watched{segAvg != null ? ` · average ${segAvg.toFixed(2)}` : ""}
                </span>
                <button className="btn small" onClick={() => bulk(s, "watched")}>Mark all watched</button>
                <QuickRate onRate={(r) => bulk(s, "rate_unrated", r)} />
                <button className="btn small" onClick={() => bulk(s, "skipped")}>Skip season</button>
                <button className="btn small ghost" onClick={() => confirm(`Reset every episode in ${s.label} to not watched? Ratings in this season will be cleared.`) && bulk(s, "unwatched")}>
                  Reset
                </button>
              </div>
              <div className="ep-list">
                {sorted.map((e) => (
                  <div className="ep-row" key={e.id}>
                    <button
                      id={`ep-${e.id}`}
                      className={`${cellClass(e, pointer.nextEpisode?.id === e.id)}${busy.has(e.id) ? " busy" : ""}`}
                      aria-label={cellLabel(s, e)}
                      onClick={(ev) => openFor(s, e, ev.currentTarget)}
                    >
                      {cellText(e)}
                    </button>
                    <div className="t">
                      <strong>{e.number}. {e.title ?? `Episode ${e.number}`}</strong>
                      <span>{[e.airDate, e.filler ? "Filler" : null, e.state === "skipped" ? "Skipped" : null].filter(Boolean).join(" · ")}</span>
                    </div>
                    <span className="hint">{episodeCode(s, e)}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })()
      )}

      <Legend />

      {open && current && (
        <EpisodeEditor
          seg={open.seg}
          ep={current}
          rect={open.rect}
          onClose={() => {
            const id = open.ep.id;
            setOpen(null);
            requestAnimationFrame(() => document.getElementById(`ep-${id}`)?.focus());
          }}
          onSave={(p) => save(current, p)}
        />
      )}
    </div>
  );
}

function QuickRate({ onRate }: { onRate: (r: number) => void }) {
  const [v, setV] = useState("");
  return (
    <span className="toolbar" style={{ gap: 4 }}>
      <label>
        <span className="visually-hidden">Rating for unrated episodes</span>
        <select className="select" style={{ padding: "4px 8px", width: "auto" }} value={v} onChange={(e) => setV(e.target.value)}>
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

function EpisodeEditor({ seg, ep, rect, onClose, onSave }: { seg: SegmentView; ep: EpisodeView; rect: DOMRect; onClose: () => void; onSave: (p: Patch) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>("button[aria-pressed='true'], .rate-grid button")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [onClose]);
  const width = Math.min(360, window.innerWidth - 24);
  const left = Math.max(12, Math.min(rect.left + rect.width / 2 - width / 2, window.innerWidth - width - 12));
  const below = rect.bottom + 330 < window.innerHeight;
  const style: React.CSSProperties = below ? { left, top: rect.bottom + 8 } : { left, bottom: window.innerHeight - rect.top + 8 };
  const rateAndClose = (r: number) => {
    onSave({ rating: r });
    onClose();
  };
  return (
    <div className="pop" ref={ref} style={style} role="dialog" aria-label={`Edit ${episodeCode(seg, ep)}`}>
      <div>
        <h3>{episodeCode(seg, ep)}{ep.title ? `: ${ep.title}` : ""}</h3>
        <p className="hint">{seg.label}{ep.airDate ? ` · aired ${ep.airDate}` : ""}</p>
      </div>
      <div className="rate-grid" role="group" aria-label="Rating">
        {RATING_STEPS.map((r) => (
          <button key={r} className={`cell ${ratingBand(r).key}`} aria-pressed={ep.rating === r} aria-label={`${r} stars`} onClick={() => rateAndClose(r)}>
            {formatScore(r)}
          </button>
        ))}
      </div>
      <div className="pop-actions">
        <button className="btn small" aria-pressed={ep.state === "watched" && ep.rating == null} onClick={() => { onSave({ state: "watched", rating: null }); onClose(); }}>Watched, no rating</button>
        <button className="btn small" aria-pressed={ep.state === "skipped"} onClick={() => { onSave({ state: "skipped" }); onClose(); }}>Skip (N/A)</button>
        <button className="btn small" aria-pressed={ep.state === "unwatched"} onClick={() => { onSave({ state: "unwatched" }); onClose(); }}>Not watched</button>
      </div>
      <label className="check">
        <input type="checkbox" checked={ep.filler} onChange={(e) => onSave({ filler: e.target.checked })} />
        Filler episode (keeps the rating)
      </label>
    </div>
  );
}

export function Legend() {
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
      <span className="sw"><span style={{ width: 26, height: 20, display: "inline-block" }} aria-hidden="true" />Blank: no such episode</span>
    </div>
  );
}
