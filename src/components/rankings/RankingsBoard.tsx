"use client";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import { useToast } from "../Toasts";
import { Poster } from "../Poster";
import { mediaHref } from "@/lib/domain/links";
import { TIERS, TIER_KEYS, tierForRating, type RankItem, type RankingsView, type Tier } from "@/lib/domain/rankings";
import type { MediaType } from "@/lib/domain/types";

const KINDS: { key: MediaType; label: string; cat: string }[] = [
  { key: "movie", label: "Movies", cat: "movies" },
  { key: "tv", label: "TV Shows", cat: "tv" },
  { key: "anime", label: "Anime", cat: "anime" },
];
type Mode = "top" | "tiers";

/** Rankings: your numbered top list (with a podium) and a drag-and-drop tier list. */
export function RankingsBoard({ initial, mode: mode0 }: { initial: RankingsView; mode: Mode }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [view, setView] = useState(initial);
  const [mode, setMode] = useState<Mode>(mode0);
  useEffect(() => setView(initial), [initial]);

  const go = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) next.set(k, v);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };

  return (
    <div className="rank-page">
      <div className="rank-switch">
        <div className="seg" role="tablist" aria-label="Kind">
          {KINDS.map((k) => (
            <button key={k.key} type="button" role="tab" className={`cat-${k.cat}`} aria-selected={view.kind === k.key} aria-current={view.kind === k.key ? "page" : undefined} onClick={() => go({ kind: k.key })}>
              {k.label}
            </button>
          ))}
        </div>
        <div className="rank-modes" role="tablist" aria-label="How to rank">
          <button type="button" role="tab" aria-selected={mode === "top"} onClick={() => { setMode("top"); go({ mode: "top" }); }}>
            <span aria-hidden="true">🏆</span> Top list
          </button>
          <button type="button" role="tab" aria-selected={mode === "tiers"} onClick={() => { setMode("tiers"); go({ mode: "tiers" }); }}>
            <span aria-hidden="true">▤</span> Tier list
          </button>
        </div>
      </div>
      {mode === "top" ? <TopList view={view} onView={setView} /> : <TierBoard view={view} onView={setView} />}
    </div>
  );
}

/* ---------------- numbered top list ---------------- */

function useSaver<T>(url: string, makeBody: (x: T) => unknown, onSaved: (v: RankingsView) => void) {
  const toast = useToast();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  return (x: T) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        onSaved((await api<{ rankings: RankingsView }>(url, { method: "PUT", body: makeBody(x) })).rankings);
      } catch (e) {
        toast.push("error", `Not saved: ${(e as Error).message}`);
      }
    }, 350);
  };
}

function Stars({ r }: { r: number | null }) {
  return r != null ? <span className="rank-stars">★ {r}</span> : null;
}
function Imdb({ v }: { v: number | null }) {
  return v != null ? <span className="imdb-badge"><b>IMDb</b> {v.toFixed(1)}</span> : null;
}

function TopList({ view }: { view: RankingsView; onView: (v: RankingsView) => void }) {
  const [list, setList] = useState(view.top);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<RankItem[]>([]);
  const [drag, setDrag] = useState<number | null>(null);
  useEffect(() => setList(view.top), [view.top]);
  const save = useSaver<RankItem[]>("/api/rankings", (l) => ({ kind: view.kind, top: l.map((i) => i.id) }), () => {});
  const update = (l: RankItem[]) => {
    setList(l);
    save(l);
  };
  const onList = new Set(list.map((i) => i.id));

  // Add: anything of this kind in your library.
  useEffect(() => {
    if (q.trim().length < 2) return setHits([]);
    const t = setTimeout(async () => {
      try {
        const r = await api<{ items: (RankItem & { review: { rating: number | null }; imdb: { rating: number } | null })[] }>(`/api/media?type=${view.kind}&q=${encodeURIComponent(q.trim())}&pageSize=10`);
        setHits(r.items.map((m) => ({ id: m.id, type: m.type, title: m.title, year: m.year, posterUrl: m.posterUrl, rating: m.review.rating, imdb: m.imdb?.rating ?? null })));
      } catch {}
    }, 200);
    return () => clearTimeout(t);
  }, [q, view.kind]);

  const fromRatings = () => {
    const best = [...view.pool, ...Object.values(view.tiers).flat()]
      .filter((i) => i.rating != null && !onList.has(i.id))
      .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0) || (b.imdb ?? 0) - (a.imdb ?? 0));
    update([...list, ...best].slice(0, Math.max(10, list.length)));
  };
  const move = (from: number, to: number) => {
    const l = [...list];
    const [x] = l.splice(from, 1);
    l.splice(Math.max(0, Math.min(l.length, to)), 0, x);
    update(l);
  };
  const [one, two, three] = list;
  const noun = view.kind === "movie" ? "movie" : view.kind === "tv" ? "show" : "anime";

  return (
    <div className="stack">
      <div className="toolbar">
        <label className="search-add grow">
          <span className="visually-hidden">Add to your top list</span>
          <input className="input" type="search" value={q} placeholder={`Add a ${noun} to your top list…`} onChange={(e) => setQ(e.target.value)} />
          {hits.length > 0 && (
            <ul className="search-hits">
              {hits.map((h) => (
                <li key={h.id}>
                  <button type="button" disabled={onList.has(h.id)} onClick={() => { update([...list, h]); setQ(""); }}>
                    <Poster url={h.posterUrl} title={h.title} />
                    <span>{h.title}<small>{h.year ?? ""}{h.rating != null ? ` · ★ ${h.rating}` : ""}</small></span>
                    <b>{onList.has(h.id) ? `#${list.findIndex((x) => x.id === h.id) + 1}` : `+ #${list.length + 1}`}</b>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </label>
        <button className="btn" onClick={fromRatings}>{list.length ? "Add more from my ratings" : "Start from my ratings"}</button>
      </div>

      {list.length === 0 ? (
        <div className="rank-empty">
          <span aria-hidden="true">🏆</span>
          <p>Who&apos;s your number one {noun}? Search above to add titles, or start from your ratings and drag them into order.</p>
        </div>
      ) : (
        <>
          <div className="podium">
            {[two, one, three].map((it, k) => {
              const place = [2, 1, 3][k];
              return it ? (
                <div key={it.id} className={`podium-spot p${place}`}>
                  {place === 1 && <span className="crown" aria-hidden="true">👑</span>}
                  <Link href={mediaHref(it)} className="podium-poster"><Poster url={it.posterUrl} title={it.title} /></Link>
                  <b className="podium-title">{it.title}</b>
                  <span className="podium-meta"><Stars r={it.rating} /> <Imdb v={it.imdb} /></span>
                  <div className="podium-block"><span>{place}</span></div>
                </div>
              ) : (
                <div key={`empty-${place}`} className={`podium-spot p${place} empty`}><div className="podium-block"><span>{place}</span></div></div>
              );
            })}
          </div>
          <ol className="countdown" start={1}>
            {list.map((it, idx) => (
              <li
                key={it.id}
                draggable
                onDragStart={() => setDrag(idx)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (drag != null && drag !== idx) move(drag, idx);
                  setDrag(null);
                }}
                className={`${drag === idx ? "dragging" : ""}${idx < 3 ? " top3" : ""}`}
              >
                <span className={`big-n n${Math.min(idx + 1, 4)}`} aria-label={`Number ${idx + 1}`}>{idx + 1}</span>
                <Link href={mediaHref(it)} className="cd-poster"><Poster url={it.posterUrl} title={it.title} /></Link>
                <div className="cd-body">
                  <Link href={mediaHref(it)} className="cd-title">{it.title}</Link>
                  <span className="cd-meta">{it.year ?? ""} <Stars r={it.rating} /> <Imdb v={it.imdb} /></span>
                </div>
                <div className="cd-actions">
                  <button className="btn small ghost" disabled={idx === 0} onClick={() => move(idx, idx - 1)} aria-label={`Move ${it.title} up`}>↑</button>
                  <button className="btn small ghost" disabled={idx === list.length - 1} onClick={() => move(idx, idx + 1)} aria-label={`Move ${it.title} down`}>↓</button>
                  <button className="btn small ghost" onClick={() => update(list.filter((x) => x.id !== it.id))} aria-label={`Take ${it.title} off your top list`}>✕</button>
                </div>
              </li>
            ))}
          </ol>
          <p className="hint">Drag to reorder, or use the arrows. Saved as you go.</p>
        </>
      )}
    </div>
  );
}

/* ---------------- tier list ---------------- */

type Board = Record<Tier | "pool", number[]>;

function TierBoard({ view, onView }: { view: RankingsView; onView: (v: RankingsView) => void }) {
  const items = useMemo(() => {
    const m = new Map<number, RankItem>();
    for (const i of [...view.pool, ...Object.values(view.tiers).flat()]) m.set(i.id, i);
    return m;
  }, [view]);
  const fromView = (v: RankingsView): Board => ({ ...(Object.fromEntries(TIER_KEYS.map((k) => [k, v.tiers[k].map((i) => i.id)])) as Record<Tier, number[]>), pool: v.pool.map((i) => i.id) });
  const [board, setBoard] = useState<Board>(() => fromView(view));
  const [picked, setPicked] = useState<number | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  useEffect(() => setBoard(fromView(view)), [view]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = useSaver<Board>("/api/rankings", (b) => ({ kind: view.kind, tiers: Object.fromEntries(TIER_KEYS.map((k) => [k, b[k]])) }), (v) => onView(v));

  const place = (id: number, to: Tier | "pool", before?: number) => {
    setBoard((b) => {
      const next = Object.fromEntries(Object.entries(b).map(([k, ids]) => [k, ids.filter((x) => x !== id)])) as Board;
      const row = next[to];
      const at = before != null ? row.indexOf(before) : -1;
      if (at >= 0) row.splice(at, 0, id);
      else row.push(id);
      save(next);
      return next;
    });
    setPicked(null);
  };
  const autoSort = () => {
    setBoard((b) => {
      const next = { ...b, pool: [] as number[] } as Board;
      for (const k of TIER_KEYS) next[k] = [...b[k]];
      for (const id of b.pool) {
        const t = tierForRating(items.get(id)?.rating ?? null);
        if (t) next[t].push(id);
        else next.pool.push(id);
      }
      save(next);
      return next;
    });
  };
  const clearAll = () => {
    if (!window.confirm("Move every title back to the tray?")) return;
    setBoard((b) => {
      const next = { pool: [...TIER_KEYS.flatMap((k) => b[k]), ...b.pool] } as Board;
      for (const k of TIER_KEYS) next[k] = [];
      save(next);
      return next;
    });
  };

  const tile = (id: number, row: Tier | "pool") => {
    const it = items.get(id);
    if (!it) return null;
    return (
      <button
        key={id}
        type="button"
        className={`tier-tile${picked === id ? " picked" : ""}`}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData("text/plain", String(id));
          e.dataTransfer.effectAllowed = "move";
        }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          const dragged = Number(e.dataTransfer.getData("text/plain"));
          if (dragged && dragged !== id) place(dragged, row, id);
          setOver(null);
        }}
        onClick={() => (picked == null ? setPicked(id) : picked === id ? setPicked(null) : place(picked, row, id))}
        title={`${it.title}${it.year ? ` (${it.year})` : ""}${it.rating != null ? ` · ★ ${it.rating}` : ""}`}
        aria-label={`${it.title}${picked === id ? ", picked: tap a tier to move it" : ""}`}
      >
        <Poster url={it.posterUrl} title={it.title} />
        {it.rating != null && <span className="tile-rating">{it.rating}</span>}
      </button>
    );
  };
  const dropZone = (row: Tier | "pool") => ({
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      setOver(row);
    },
    onDragLeave: () => setOver((o) => (o === row ? null : o)),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      const id = Number(e.dataTransfer.getData("text/plain"));
      if (id) place(id, row);
      setOver(null);
    },
    onClick: () => picked != null && place(picked, row),
  });
  const poolShown = board.pool.filter((id) => !filter.trim() || items.get(id)?.title.toLowerCase().includes(filter.trim().toLowerCase()));
  const placed = TIER_KEYS.reduce((a, k) => a + board[k].length, 0);

  return (
    <div className="stack">
      <div className="toolbar">
        <span className="hint grow">{placed} placed · {board.pool.length} still in the tray. Drag posters into a tier, or tap one then tap a tier.</span>
        <button className="btn" disabled={!board.pool.some((id) => items.get(id)?.rating != null)} onClick={autoSort}>Auto-sort by my ratings</button>
        <button className="btn ghost" disabled={!placed} onClick={clearAll}>Clear</button>
      </div>
      <div className="tier-board">
        {TIERS.map((t) => (
          <div key={t.key} className={`tier-row${over === t.key ? " over" : ""}${picked != null ? " can-drop" : ""}`}>
            <div className="tier-label" style={{ background: t.color }}>
              <b>{t.label}</b>
              <small>{t.blurb}</small>
            </div>
            <div className="tier-items" {...dropZone(t.key)}>
              {board[t.key].map((id) => tile(id, t.key))}
              {board[t.key].length === 0 && <span className="tier-empty">Drop here</span>}
            </div>
            <span className="tier-count" aria-label={`${board[t.key].length} in ${t.label} tier`}>{board[t.key].length}</span>
          </div>
        ))}
      </div>
      <section className={`tier-tray${over === "pool" ? " over" : ""}`} aria-label="Not ranked yet">
        <div className="toolbar">
          <h3 className="grow">Not ranked yet <span className="hint">{board.pool.length}</span></h3>
          <input className="input small" type="search" value={filter} placeholder="Find a title" onChange={(e) => setFilter(e.target.value)} aria-label="Find a title in the tray" />
        </div>
        <div className="tier-items tray" {...dropZone("pool")}>
          {poolShown.map((id) => tile(id, "pool"))}
          {board.pool.length === 0 && <span className="tier-empty">Everything you&apos;ve watched is ranked. Drag a poster here to take it out.</span>}
        </div>
      </section>
    </div>
  );
}
