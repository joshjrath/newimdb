"use client";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EpisodeView, SegmentView } from "@/lib/domain/types";
import { activePointer, allEpisodes, computeProgress, episodeAverage, episodeCode, isUnaired, orderedSegments, sortedEpisodes } from "@/lib/domain/progress";
import { RATING_BANDS, RATING_STEPS, formatScore, ratingBand } from "@/lib/domain/rating";
import { resolveAssessment, type AssessmentPatch } from "@/lib/domain/assessment";
import type { BulkAssessAction } from "@/lib/schemas";
import { api } from "@/lib/client/api";
import { useToast } from "./Toasts";
import { ProgressBar } from "./ProgressBar";

type OpenEditor = { segId: number; epId: number; rect: DOMRect };
type OnOpen = (seg: SegmentView, ep: EpisodeView, el: HTMLElement, ev: React.MouseEvent) => void;
type Flat = { seg: SegmentView; ep: EpisodeView };

/** Typed ratings: "4" → 4, "4" then "5" (or ".") → 4.5, "0" then "5" → 0.5. */
const HALF_WINDOW_MS = 450;

function cellText(e: EpisodeView) {
  if (e.rating != null) return formatScore(e.rating);
  if (isUnaired(e)) return "TBA";
  return e.state === "watched" ? "✓" : e.state === "skipped" ? "N/A" : "?";
}

function cellLabel(seg: SegmentView, e: EpisodeView) {
  const state =
    e.rating != null ? `rated ${e.rating} of 5`
    : e.state === "watched" ? "watched, not rated"
    : e.state === "skipped" ? "skipped (N/A)"
    : isUnaired(e) ? `not out yet${e.airDate && e.airDate !== "TBA" ? ` (airs ${e.airDate})` : ""}`
    : "not watched";
  return [episodeCode(seg, e), e.title, state, e.filler && "filler"].filter(Boolean).join(", ");
}

/** One heatmap cell. Memoised so a save re-renders only the cell that changed. */
const EpisodeCell = memo(function EpisodeCell({ seg, ep, isNext, busy, selected, focusable, onOpen, onFocusCell }: {
  seg: SegmentView;
  ep: EpisodeView;
  isNext: boolean;
  busy: boolean;
  selected: boolean;
  focusable: boolean;
  onOpen: OnOpen;
  onFocusCell: (id: number) => void;
}) {
  const label = cellLabel(seg, ep);
  const band = ep.rating != null ? ratingBand(ep.rating).key : isUnaired(ep) ? "unaired" : ep.state;
  return (
    <button
      id={`ep-${ep.id}`}
      data-ep={ep.id}
      tabIndex={focusable ? 0 : -1}
      aria-pressed={selected || undefined}
      className={["cell", band, ep.filler && "filler", isNext && "next", busy && "busy", selected && "sel"].filter(Boolean).join(" ")}
      aria-label={label}
      title={label}
      onFocus={() => onFocusCell(ep.id)}
      onClick={(ev) => onOpen(seg, ep, ev.currentTarget, ev)}
    >
      {cellText(ep)}
    </button>
  );
});

export function Heatmap({ mediaId, initial, initialSegment, onSegments, ignoreFiller = false }: { mediaId: number; initial: SegmentView[]; initialSegment?: number | null; onSegments?: (s: SegmentView[]) => void; /** Anime: unwatched filler isn't counted, and Up next skips it. */ ignoreFiller?: boolean }) {
  const [segments, setSegments] = useState(initial);
  // Let the page know (e.g. the season editor next to the grid) after each change.
  const reported = useRef(initial);
  useEffect(() => {
    if (segments !== reported.current) {
      reported.current = segments;
      onSegments?.(segments);
    }
  }, [segments, onSegments]);
  const [focusId, setFocusId] = useState<number | null>(null);
  const [selection, setSelection] = useState<ReadonlySet<number>>(new Set());
  const anchor = useRef<number | null>(null);
  const typed = useRef<{ digit: number; timer: ReturnType<typeof setTimeout> } | null>(null);
  const [view, setView] = useState<"grid" | number>(initialSegment && initial.some((s) => s.id === initialSegment) ? initialSegment : "grid");
  const [open, setOpen] = useState<OpenEditor | null>(null);
  const [busy, setBusy] = useState<ReadonlySet<number>>(new Set());
  const toast = useToast();

  const { ordered, progress, pointer, avg, maxCols } = useMemo(() => {
    const ordered = orderedSegments(segments);
    const eps = allEpisodes(segments);
    return {
      ordered,
      progress: computeProgress(eps, { ignoreFiller }),
      pointer: activePointer(segments, { ignoreFiller }),
      avg: episodeAverage(eps),
      maxCols: Math.max(0, ...ordered.map((s) => s.episodes.length)),
    };
  }, [segments, ignoreFiller]);
  const nextId = pointer.nextEpisode?.id;
  // Watch order, for keyboard movement, ranges and "watched up to here".
  const flat: Flat[] = useMemo(() => ordered.flatMap((seg) => sortedEpisodes(seg).map((ep) => ({ seg, ep }))), [ordered]);
  const indexOf = useMemo(() => new Map(flat.map((f, i) => [f.ep.id, i])), [flat]);
  const activeId = focusId ?? nextId ?? flat[0]?.ep.id ?? null;

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

  const bulkIds = async (ids: number[], action: BulkAssessAction, rating: number | undefined, label: string) => {
    if (!ids.length) return;
    try {
      const r = await api<{ segments: SegmentView[] }>(`/api/media/${mediaId}/episodes/bulk`, { body: { episodeIds: ids, action, rating } });
      setSegments(r.segments);
      toast.push("ok", label);
    } catch (e) {
      toast.push("error", `Not saved: ${(e as Error).message}`);
    }
  };
  const bulk = (seg: SegmentView, action: BulkAssessAction, rating?: number) => bulkIds(seg.episodes.map((e) => e.id), action, rating, `${seg.label} updated.`);

  /** Mark every earlier episode (in watch order) that isn't watched or skipped as watched. */
  const watchedUpTo = (epId: number) => {
    const i = indexOf.get(epId) ?? -1;
    const ids = flat.slice(0, i + 1).filter((f) => f.ep.state === "unwatched").map((f) => f.ep.id);
    bulkIds(ids, "watched", undefined, ids.length ? `Marked ${ids.length} episode${ids.length === 1 ? "" : "s"} watched.` : "Already watched.");
  };

  /** The episodes an action applies to: the selection when the focused cell is in it, else just that cell. */
  const targetsFor = (epId: number): number[] => (selection.has(epId) && selection.size > 1 ? [...selection] : [epId]);

  const apply = (epId: number, patch: AssessmentPatch, advance: boolean) => {
    const ids = targetsFor(epId);
    if (ids.length > 1) {
      const action: BulkAssessAction | null =
        patch.rating != null ? "rate" : patch.filler === true ? "filler_on" : patch.filler === false ? "filler_off" : patch.state ?? null;
      if (action) bulkIds(ids, action, patch.rating ?? undefined, `Updated ${ids.length} episodes.`);
      setSelection(new Set());
      return;
    }
    const f = flat[indexOf.get(epId) ?? -1];
    if (!f) return;
    save(f.ep, patch);
    if (advance) moveFocus(epId, 1);
  };

  const focusCell = (id: number | undefined) => {
    if (id == null) return;
    setFocusId(id);
    requestAnimationFrame(() => document.getElementById(`ep-${id}`)?.focus());
  };

  const moveFocus = (fromId: number, step: number) => focusCell(flat[Math.min(flat.length - 1, Math.max(0, (indexOf.get(fromId) ?? 0) + step))]?.ep.id);

  /** Up/down in the grid: same episode number in the previous/next season, clamped to its length. */
  const moveRow = (fromId: number, dir: number) => {
    const f = flat[indexOf.get(fromId) ?? -1];
    if (!f) return;
    const r = ordered.findIndex((s) => s.id === f.seg.id) + dir;
    const target = ordered[r];
    if (!target) return;
    const eps = sortedEpisodes(target);
    const col = sortedEpisodes(f.seg).findIndex((e) => e.id === fromId);
    focusCell(eps[Math.min(col, eps.length - 1)]?.id);
  };

  const commitTyped = (epId: number, rating: number) => {
    if (typed.current) clearTimeout(typed.current.timer);
    typed.current = null;
    if (rating >= 0.5 && rating <= 5) apply(epId, { rating }, true);
  };

  const onCellKey = (e: React.KeyboardEvent) => {
    const id = Number((e.target as HTMLElement).dataset?.ep);
    if (!id || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key;
    const pending = typed.current;
    if (/^[0-5]$/.test(k)) {
      e.preventDefault();
      const d = Number(k);
      if (pending && d === 5 && pending.digit < 5) return commitTyped(id, pending.digit + 0.5);
      if (pending) commitTyped(id, pending.digit);
      if (d === 5) return commitTyped(id, 5);
      const timer = setTimeout(() => commitTyped(id, d), HALF_WINDOW_MS);
      typed.current = { digit: d, timer };
      return;
    }
    if ((k === "." || k === ",") && pending) {
      e.preventDefault();
      return commitTyped(id, pending.digit + 0.5);
    }
    const map: Record<string, () => void> = {
      ArrowRight: () => moveFocus(id, 1),
      ArrowLeft: () => moveFocus(id, -1),
      ArrowDown: () => (view === "grid" ? moveRow(id, 1) : moveFocus(id, 1)),
      ArrowUp: () => (view === "grid" ? moveRow(id, -1) : moveFocus(id, -1)),
      Home: () => focusCell(flat[0]?.ep.id),
      End: () => focusCell(flat[flat.length - 1]?.ep.id),
      w: () => apply(id, { state: "watched", rating: null }, true),
      s: () => apply(id, { state: "skipped" }, true),
      x: () => apply(id, { state: "skipped" }, true),
      f: () => {
        const ep = flat[indexOf.get(id) ?? -1]?.ep;
        if (ep) apply(id, { filler: !ep.filler }, false);
      },
      u: () => watchedUpTo(id),
      Backspace: () => apply(id, { state: "unwatched" }, false),
      Delete: () => apply(id, { state: "unwatched" }, false),
      Escape: () => setSelection(new Set()),
    };
    const fn = map[k] ?? map[k.toLowerCase()];
    if (!fn) return;
    e.preventDefault();
    if (e.shiftKey && k.startsWith("Arrow")) {
      // Shift+arrows grow the selection.
      const before = id;
      fn();
      requestAnimationFrame(() => {
        const now = Number((document.activeElement as HTMLElement | null)?.dataset?.ep);
        if (now) selectRange(anchor.current ?? before, now);
      });
      return;
    }
    fn();
  };

  const selectRange = (a: number, b: number) => {
    const [i, j] = [indexOf.get(a) ?? 0, indexOf.get(b) ?? 0].sort((x, y) => x - y);
    anchor.current = a;
    setSelection(new Set(flat.slice(i, j + 1).map((f) => f.ep.id)));
  };

  const onOpen = useCallback<OnOpen>(
    (seg, ep, el, ev) => {
      setFocusId(ep.id);
      if (ev.shiftKey && anchor.current != null) {
        selectRange(anchor.current, ep.id);
        return;
      }
      if (ev.metaKey || ev.ctrlKey) {
        setSelection((cur) => {
          const n = new Set(cur);
          if (!n.delete(ep.id)) n.add(ep.id);
          return n;
        });
        anchor.current = ep.id;
        return;
      }
      anchor.current = ep.id;
      if (!selection.has(ep.id)) setSelection(new Set());
      setOpen({ segId: seg.id, epId: ep.id, rect: el.getBoundingClientRect() });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selection, flat, indexOf],
  );
  const onFocusCell = useCallback((id: number) => setFocusId(id), []);
  const onClose = useCallback(() => {
    setOpen((o) => {
      if (o) requestAnimationFrame(() => document.getElementById(`ep-${o.epId}`)?.focus());
      return null;
    });
  }, []);

  if (!segments.length) {
    return (
      <div className="empty-state">
        <p>No seasons yet. Use Edit seasons above to add seasons, cours or specials, then rate episodes here.</p>
      </div>
    );
  }

  const openSeg = open && segments.find((s) => s.id === open.segId);
  const openEp = openSeg && openSeg.episodes.find((e) => e.id === open.epId);
  const cell = (s: SegmentView, e: EpisodeView) => (
    <EpisodeCell seg={s} ep={e} isNext={nextId === e.id} busy={busy.has(e.id)} selected={selection.has(e.id)} focusable={activeId === e.id} onOpen={onOpen} onFocusCell={onFocusCell} />
  );
  const current = view === "grid" ? null : ordered.find((x) => x.id === view);

  return (
    <div className="stack">
      <ProgressBar p={progress} big />
      <div className="stat-row">
        <div className="stat"><span className="v">{avg != null ? avg.toFixed(2) : "–"}</span><span className="k">Episode average (calculated)</span></div>
        <div className="stat"><span className="v">{progress.rated}</span><span className="k">Episodes rated</span></div>
        {pointer.nextEpisode && pointer.segment ? (
          <button type="button" className="stat stat-btn" onClick={() => focusCell(pointer.nextEpisode!.id)} title="Go to the next episode">
            <span className="v">{episodeCode(pointer.segment, pointer.nextEpisode)}</span>
            <span className="k">Up next · rate it</span>
          </button>
        ) : (
          <div className="stat">
            <span className="v">{pointer.caughtUp ? "Caught up" : "–"}</span>
            <span className="k">Up next</span>
          </div>
        )}
      </div>

      <div className="segment-tabs" role="tablist" aria-label="Seasons">
        <button role="tab" className="chip" aria-selected={view === "grid"} aria-pressed={view === "grid"} onClick={() => setView("grid")}>All seasons</button>
        {ordered.map((s) => (
          <button key={s.id} role="tab" className="chip" aria-selected={view === s.id} aria-pressed={view === s.id} onClick={() => setView(s.id)}>
            {s.label}
          </button>
        ))}
      </div>

      <p className="hint keys-hint">
        Click an episode, or use the arrow keys, then type a rating: <kbd>4</kbd> = 4, <kbd>4</kbd><kbd>5</kbd> = 4.5. It saves and moves to the next one.{" "}
        <kbd>W</kbd> watched · <kbd>S</kbd> skip · <kbd>F</kbd> filler · <kbd>U</kbd> watched up to here · <kbd>⌫</kbd> clear. Shift-click to select a run of episodes.
      </p>

      {selection.size > 1 && (
        <div className="bulkbar" role="region" aria-label="Selected episodes">
          <strong>{selection.size} episodes selected</strong>
          <span className="hint" style={{ color: "inherit" }}>Type a rating, or:</span>
          <button className="btn small" onClick={() => apply([...selection][0], { state: "watched" }, false)}>Watched</button>
          <button className="btn small" onClick={() => apply([...selection][0], { state: "skipped" }, false)}>Skip</button>
          <button className="btn small" onClick={() => apply([...selection][0], { filler: true }, false)}>Filler</button>
          <button className="btn small" onClick={() => apply([...selection][0], { state: "unwatched" }, false)}>Not watched</button>
          <button className="btn small" onClick={() => setSelection(new Set())}>Clear selection</button>
        </div>
      )}

      {current ? (
        <div onKeyDown={onCellKey}>
          <SeasonList seg={current} cell={cell} ignoreFiller={ignoreFiller} onBulk={(action, rating) => bulk(current, action, rating)} />
        </div>
      ) : (
        <div className="heatmap-wrap" onKeyDown={onCellKey} aria-label="Episode ratings grid. Scroll sideways for more episodes.">
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
            apply(openEp.id, p, false);
            if (close) onClose();
          }}
          onWatchedUpTo={() => {
            watchedUpTo(openEp.id);
            onClose();
          }}
        />
      )}
    </div>
  );
}

/** Single-season view: episode titles plus season-wide quick actions. */
function SeasonList({ seg, cell, onBulk, ignoreFiller }: { seg: SegmentView; cell: (s: SegmentView, e: EpisodeView) => React.ReactNode; onBulk: (action: BulkAssessAction, rating?: number) => void; ignoreFiller?: boolean }) {
  const p = computeProgress(seg.episodes, { ignoreFiller });
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

function EpisodeEditor({ seg, ep, rect, onClose, onSave, onWatchedUpTo }: { seg: SegmentView; ep: EpisodeView; rect: DOMRect; onClose: () => void; onSave: (p: AssessmentPatch, close: boolean) => void; onWatchedUpTo: () => void }) {
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
        <button className="btn small" onClick={onWatchedUpTo} title="Marks every earlier episode you haven't watched or skipped as watched">Watched up to here</button>
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
      <span className="sw"><span className="cell unaired" aria-hidden="true">TBA</span>Not out yet (doesn&apos;t count)</span>
      <span className="sw"><span className="cell unwatched filler" aria-hidden="true">?</span>Filler (any state)</span>
      <span className="sw"><span className="blank" aria-hidden="true" />Blank: no such episode</span>
    </div>
  );
}
