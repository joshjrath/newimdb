"use client";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import { useToast } from "../Toasts";
import { Poster } from "../Poster";
import { mediaHref } from "@/lib/domain/links";
import { TIERS, TIER_KEYS, tierForRating, type BoardSummary, type RankItem, type RankingsView, type Tier } from "@/lib/domain/rankings";
import { useAction } from "../useAction";
import type { MediaType } from "@/lib/domain/types";

const KINDS: { key: MediaType; label: string; cat: string }[] = [
  { key: "movie", label: "Movies", cat: "movies" },
  { key: "tv", label: "TV Shows", cat: "tv" },
  { key: "anime", label: "Anime", cat: "anime" },
];
type Mode = "top" | "tiers";
type View = Pick<RankingsView, "top" | "tiers" | "pool">;
/** What is being ranked: one of the built-in Movies / TV / Anime rankings, or one of yours. */
export type Target = { kind: MediaType; board?: undefined } | { kind?: undefined; board: BoardSummary };
type Choice = { id: number; name: string };

const saveUrl = (t: Target) => (t.board ? `/api/rankings/boards/${t.board.id}` : "/api/rankings");
const saveBody = (t: Target, b: object) => (t.board ? b : { kind: t.kind, ...b });
/** Search scope: the board's kind if it has one, else everything in your library. */
const searchType = (t: Target) => t.kind ?? (t.board.source === "kind" ? t.board.sourceRef : null);
const nounOf = (t: Target) => (t.kind === "movie" ? "movie" : t.kind === "tv" ? "show" : t.kind === "anime" ? "anime" : "title");

/** Rankings: your numbered top list (with a podium) and a drag-and-drop tier list — built-in or your own. */
export function RankingsBoard({ initial, target, mode: mode0, boards, lists, genres }: { initial: View; target: Target; mode: Mode; boards: BoardSummary[]; lists: Choice[]; genres: Choice[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { busy, run } = useAction();
  const [view, setView] = useState(initial);
  const [mode, setMode] = useState<Mode>(mode0);
  const [creating, setCreating] = useState(false);
  useEffect(() => setView(initial), [initial]);

  const go = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) v == null ? next.delete(k) : next.set(k, v);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };
  const pickMode = (m: Mode) => {
    setMode(m);
    go({ mode: m });
    if (target.board) void api(`/api/rankings/boards/${target.board.id}`, { method: "PATCH", body: { mode: m } }).catch(() => {});
  };
  const rename = async () => {
    if (!target.board) return;
    const name = window.prompt("Rename this ranking", target.board.name)?.trim();
    if (!name || name === target.board.name) return;
    if (await run(() => api(`/api/rankings/boards/${target.board!.id}`, { method: "PATCH", body: { name } }))) router.refresh();
  };
  const remove = async () => {
    if (!target.board || !window.confirm(`Delete the ranking "${target.board.name}"? Your titles stay in your library.`)) return;
    if (await run(() => api(`/api/rankings/boards/${target.board!.id}`, { method: "DELETE" }), { ok: "Ranking deleted." })) {
      router.replace(`${pathname}?kind=movie`, { scroll: false });
      router.refresh();
    }
  };

  return (
    <div className="rank-page">
      <div className="rank-switch">
        <div className="seg" role="tablist" aria-label="Built-in rankings">
          {KINDS.map((k) => (
            <button key={k.key} type="button" role="tab" className={`cat-${k.cat}`} aria-selected={target.kind === k.key} aria-current={target.kind === k.key ? "page" : undefined} onClick={() => go({ kind: k.key, board: null, mode: null })}>
              {k.label}
            </button>
          ))}
        </div>
        <div className="rank-modes" role="tablist" aria-label="How to rank">
          <button type="button" role="tab" aria-selected={mode === "top"} onClick={() => pickMode("top")}>
            <span aria-hidden="true">🏆</span> Top list
          </button>
          <button type="button" role="tab" aria-selected={mode === "tiers"} onClick={() => pickMode("tiers")}>
            <span aria-hidden="true">▤</span> Tier list
          </button>
        </div>
      </div>

      <nav className="board-chips" aria-label="Your rankings">
        <span className="label">Your rankings</span>
        {boards.map((b) => (
          <button key={b.id} type="button" className={`board-chip src-${b.source}`} aria-current={target.board?.id === b.id ? "page" : undefined} onClick={() => go({ board: String(b.id), kind: null, mode: null })} title={b.sourceLabel}>
            <span className="board-chip-dot" aria-hidden="true" />
            {b.name}
            <small>{b.count}</small>
          </button>
        ))}
        <button type="button" className="board-chip new" aria-expanded={creating} onClick={() => setCreating((c) => !c)}>+ New ranking</button>
      </nav>
      {creating && <NewBoard lists={lists} genres={genres} busy={busy} run={run} onDone={(id) => { setCreating(false); router.replace(`${pathname}?board=${id}`, { scroll: false }); router.refresh(); }} />}

      {target.board && (
        <div className="board-head">
          <div className="grow">
            <h2>{target.board.name}</h2>
            <p className="hint">{target.board.sourceLabel}{target.board.source === "any" ? " — search below to add titles" : " — only these titles are in the tray"}</p>
          </div>
          <button className="btn small ghost" onClick={rename} disabled={busy}>Rename</button>
          <button className="btn small ghost danger" onClick={remove} disabled={busy}>Delete</button>
        </div>
      )}
      {mode === "top" ? <TopList view={view} target={target} /> : <TierBoard view={view} target={target} onView={setView} />}
    </div>
  );
}

/* ---------------- a new ranking of your own ---------------- */

type Src = "any" | "list" | "genre" | "kind";
function NewBoard({ lists, genres, busy, run, onDone }: { lists: Choice[]; genres: Choice[]; busy: boolean; run: ReturnType<typeof useAction>["run"]; onDone: (id: number) => void }) {
  const [name, setName] = useState("");
  const [source, setSource] = useState<Src>(lists.length ? "list" : "any");
  const [ref, setRef] = useState("");
  const [mode, setMode] = useState<Mode>("tiers");
  const options: Choice[] | { id: string; name: string }[] = source === "list" ? lists : source === "genre" ? genres : source === "kind" ? KINDS.map((k) => ({ id: k.key, name: k.label })) : [];
  useEffect(() => setRef(options[0] ? String(options[0].id) : ""), [source]); // eslint-disable-line react-hooks/exhaustive-deps
  const suggested = name.trim() || (source !== "any" ? (options.find((o) => String(o.id) === ref)?.name ?? "") : "");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await run(() => api<{ id: number }>("/api/rankings/boards", { body: { name: suggested, source, sourceRef: source === "any" ? null : ref, mode } }));
    if (r) onDone(r.id);
  };
  const SOURCES: { key: Src; label: string; icon: string }[] = [
    { key: "list", label: "One of my lists", icon: "☰" },
    { key: "genre", label: "A genre", icon: "◆" },
    { key: "kind", label: "Movies, TV or Anime", icon: "▦" },
    { key: "any", label: "Start empty", icon: "＋" },
  ];
  return (
    <form className="panel new-board" onSubmit={submit}>
      <div className="new-board-sources" role="radiogroup" aria-label="Rank titles from">
        {SOURCES.map((s) => (
          <button key={s.key} type="button" role="radio" aria-checked={source === s.key} onClick={() => setSource(s.key)} disabled={(s.key === "list" && !lists.length) || (s.key === "genre" && !genres.length)}>
            <span aria-hidden="true">{s.icon}</span> {s.label}
          </button>
        ))}
      </div>
      <div className="toolbar">
        {source !== "any" && (
          <label>
            <span className="visually-hidden">Which one</span>
            <select className="input" value={ref} onChange={(e) => setRef(e.target.value)}>
              {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </label>
        )}
        <label className="grow">
          <span className="visually-hidden">Name</span>
          <input className="input" value={name} maxLength={80} placeholder={suggested ? `Name (default: ${suggested})` : "Name, e.g. Best villains"} onChange={(e) => setName(e.target.value)} />
        </label>
        <select className="input" value={mode} onChange={(e) => setMode(e.target.value as Mode)} aria-label="Start as">
          <option value="tiers">Tier list</option>
          <option value="top">Top list</option>
        </select>
        <button className="btn primary" disabled={busy || !suggested || (source !== "any" && !ref)}>Create ranking</button>
      </div>
      <p className="hint">Nothing gets auto-ranked: the titles wait in a tray and you place the ones you want.</p>
    </form>
  );
}

/* ---------------- numbered top list ---------------- */

function useSaver<T>(target: Target, makeBody: (x: T) => object, onSaved: (v: View) => void) {
  const toast = useToast();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  return (x: T) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        const r = await api<{ rankings?: View; board?: View }>(saveUrl(target), { method: "PUT", body: saveBody(target, makeBody(x)) });
        onSaved((r.rankings ?? r.board)!);
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

/** Live search of your library for titles to add (limited to the ranking's kind when it has one). */
function useLibrarySearch(target: Target) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<RankItem[]>([]);
  const type = searchType(target);
  useEffect(() => {
    if (q.trim().length < 2) return setHits([]);
    const t = setTimeout(async () => {
      try {
        const r = await api<{ items: (RankItem & { review: { rating: number | null }; imdb: { rating: number } | null })[] }>(`/api/media?${type ? `type=${type}&` : ""}q=${encodeURIComponent(q.trim())}&pageSize=10`);
        setHits(r.items.map((m) => ({ id: m.id, type: m.type, title: m.title, year: m.year, posterUrl: m.posterUrl, rating: m.review.rating, imdb: m.imdb?.rating ?? null })));
      } catch {}
    }, 200);
    return () => clearTimeout(t);
  }, [q, type]);
  return { q, setQ, hits };
}

function TopList({ view, target }: { view: View; target: Target }) {
  const [list, setList] = useState(view.top);
  const { q, setQ, hits } = useLibrarySearch(target);
  const [drag, setDrag] = useState<number | null>(null);
  useEffect(() => setList(view.top), [view.top]);
  const save = useSaver<RankItem[]>(target, (l) => ({ top: l.map((i) => i.id) }), () => {});
  const update = (l: RankItem[]) => {
    setList(l);
    save(l);
  };
  const onList = new Set(list.map((i) => i.id));

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
  const noun = nounOf(target);

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

function TierBoard({ view, target, onView }: { view: View; target: Target; onView: (v: View) => void }) {
  const [extra, setExtra] = useState<RankItem[]>([]);
  const items = useMemo(() => {
    const m = new Map<number, RankItem>();
    for (const i of [...view.pool, ...Object.values(view.tiers).flat(), ...extra]) m.set(i.id, i);
    return m;
  }, [view, extra]);
  const search = useLibrarySearch(target);
  const fromView = (v: View): Board => ({ ...(Object.fromEntries(TIER_KEYS.map((k) => [k, v.tiers[k].map((i) => i.id)])) as Record<Tier, number[]>), pool: v.pool.map((i) => i.id) });
  const [board, setBoard] = useState<Board>(() => fromView(view));
  const [picked, setPicked] = useState<number | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  useEffect(() => setBoard(fromView(view)), [view]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = useSaver<Board>(target, (b) => ({ tiers: Object.fromEntries(TIER_KEYS.map((k) => [k, b[k]])) }), (v) => onView(v));
  const onBoard = new Set(Object.values(board).flat());
  /** Add a title from search straight into the tray (place it in a tier to keep it). */
  const addToTray = (it: RankItem) => {
    setExtra((x) => [...x, it]);
    setBoard((b) => ({ ...b, pool: [it.id, ...b.pool.filter((x) => x !== it.id)] }));
    search.setQ("");
  };

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
        {target.board && (
          <label className="search-add">
            <span className="visually-hidden">Add a title to this ranking</span>
            <input className="input" type="search" value={search.q} placeholder="Add any title…" onChange={(e) => search.setQ(e.target.value)} />
            {search.hits.length > 0 && (
              <ul className="search-hits">
                {search.hits.map((h) => (
                  <li key={h.id}>
                    <button type="button" disabled={onBoard.has(h.id)} onClick={() => addToTray(h)}>
                      <Poster url={h.posterUrl} title={h.title} />
                      <span>{h.title}<small>{h.year ?? ""}{h.rating != null ? ` · ★ ${h.rating}` : ""}</small></span>
                      <b>{onBoard.has(h.id) ? "✓" : "+ tray"}</b>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </label>
        )}
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
          {board.pool.length === 0 && <span className="tier-empty">{target.board?.source === "any" ? "Search above to add titles, then drag them into a tier." : "Everything here is ranked. Drag a poster here to take it out."}</span>}
        </div>
      </section>
    </div>
  );
}
