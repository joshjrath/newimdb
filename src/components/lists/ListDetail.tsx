"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import { useAction } from "../useAction";
import { Poster } from "../Poster";
import { ListProgress } from "./ListProgress";
import { plural } from "@/lib/domain/text";
import { mediaHref } from "@/lib/domain/links";
import { TYPE_LABEL, type MediaType } from "@/lib/domain/types";
import { LIST_SORTS, type ListItemView, type ListSort, type ListSummary } from "@/lib/domain/lists";

type List = ListSummary & { items: ListItemView[] };
type Hit = { id: number; title: string; year: number | null; type: MediaType; posterUrl: string | null };

/** One list: reorder (drag or arrows), sort, add from your library, and see progress. */
export function ListDetail({ initial }: { initial: List }) {
  const [list, setList] = useState(initial);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [dragging, setDragging] = useState<number | null>(null);
  const { busy, run } = useAction();
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onList = new Set(list.items.map((i) => i.mediaId));

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (q.trim().length < 2) return setHits([]);
    timer.current = setTimeout(async () => {
      try {
        const r = await api<{ items: Hit[] }>(`/api/media?q=${encodeURIComponent(q.trim())}&pageSize=12&sort=title`);
        setHits(r.items);
      } catch {}
    }, 200);
  }, [q]);

  const add = async (h: Hit) => {
    const r = await run(() => api<{ list: List }>(`/api/lists/${list.id}/items`, { body: { mediaIds: [h.id] } }), { ok: `Added ${h.title}.` });
    if (r) setList(r.list);
  };
  const remove = async (i: ListItemView) => {
    const r = await run(() => api<{ list: List }>(`/api/lists/${list.id}/items`, { method: "DELETE", body: { mediaIds: [i.mediaId] } }), { ok: `Removed ${i.title}.` });
    if (r) setList(r.list);
  };
  const setSort = async (sort: ListSort) => {
    const r = await run(() => api<{ list: List }>(`/api/lists/${list.id}`, { method: "PATCH", body: { sort } }));
    if (r) setList(r.list);
  };
  const saveOrder = async (ids: number[]) => {
    const byId = new Map(list.items.map((i) => [i.mediaId, i]));
    setList({ ...list, sort: "manual", items: ids.map((id, n) => ({ ...byId.get(id)!, position: n + 1 })) });
    const r = await run(() => api<{ list: List }>(`/api/lists/${list.id}/order`, { method: "PUT", body: { mediaIds: ids } }));
    if (r) setList(r.list);
  };
  const move = (idx: number, by: number) => {
    const ids = list.items.map((i) => i.mediaId);
    const [x] = ids.splice(idx, 1);
    ids.splice(Math.max(0, Math.min(ids.length, idx + by)), 0, x);
    saveOrder(ids);
  };
  const saveInfo = async () => {
    const r = await run(() => api<{ list: List }>(`/api/lists/${list.id}`, { method: "PATCH", body: { name, description } }), { ok: "Saved." });
    if (r) {
      setList(r.list);
      setEditing(false);
    }
  };
  const del = async () => {
    if (!window.confirm(`Delete the list "${list.name}"? The titles stay in your library.`)) return;
    const r = await run(() => api(`/api/lists/${list.id}`, { method: "DELETE" }));
    if (r) router.push("/lists");
  };

  return (
    <div className="stack">
      <section className="panel list-head">
        {editing ? (
          <div className="stack tight">
            <input className="input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} aria-label="List name" />
            <textarea className="textarea" value={description} maxLength={2000} placeholder="What's this list for?" onChange={(e) => setDescription(e.target.value)} aria-label="Description" />
            <div className="toolbar">
              <button className="btn small primary" disabled={busy || !name.trim()} onClick={saveInfo}>Save</button>
              <button className="btn small ghost" onClick={() => setEditing(false)}>Cancel</button>
            </div>
          </div>
        ) : (
          <>
            <div className="toolbar">
              <h1 className="grow">{list.name}</h1>
              <button className="btn small ghost" onClick={() => setEditing(true)}>Edit</button>
              <button className="btn small ghost" onClick={del}>Delete</button>
            </div>
            {list.description && <p className="muted">{list.description}</p>}
          </>
        )}
        <ListProgress percent={list.percent} label={`${list.finished} of ${plural(list.count, "title", "titles")} finished · ${list.percent}%`} />
      </section>

      <div className="toolbar">
        <label className="search-add grow">
          <span className="visually-hidden">Add a title from your library</span>
          <input className="input" type="search" value={q} placeholder="Add a movie, show or anime from your library…" onChange={(e) => setQ(e.target.value)} />
          {hits.length > 0 && (
            <ul className="search-hits">
              {hits.map((h) => (
                <li key={h.id}>
                  <button type="button" disabled={busy || onList.has(h.id)} onClick={() => add(h)}>
                    <Poster url={h.posterUrl} title={h.title} />
                    <span>{h.title}<small>{TYPE_LABEL[h.type]}{h.year ? ` · ${h.year}` : ""}</small></span>
                    <b>{onList.has(h.id) ? "On list" : "+ Add"}</b>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </label>
        <label>
          <span className="visually-hidden">Sort</span>
          <select className="select" value={list.sort} onChange={(e) => setSort(e.target.value as ListSort)}>
            {LIST_SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </label>
      </div>
      {list.sort === "manual" && list.items.length > 1 && <p className="hint">Drag titles (or use the arrows) to put them in your order, e.g. story order for the MCU.</p>}

      <ol className="list-items">
        {list.items.map((i, idx) => (
          <li
            key={i.mediaId}
            draggable={list.sort === "manual"}
            onDragStart={() => setDragging(idx)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              if (dragging == null || dragging === idx) return;
              const ids = list.items.map((x) => x.mediaId);
              const [x] = ids.splice(dragging, 1);
              ids.splice(idx, 0, x);
              setDragging(null);
              saveOrder(ids);
            }}
            className={`${dragging === idx ? "dragging" : ""}${i.done >= 1 ? " finished" : ""}`}
          >
            <span className="list-n">{idx + 1}</span>
            <Link href={mediaHref({ id: i.mediaId, type: i.type, title: i.title })} className="list-item-poster"><Poster url={i.posterUrl} title={i.title} /></Link>
            <div className="list-item-body">
              <Link href={mediaHref({ id: i.mediaId, type: i.type, title: i.title })} className="list-item-title">{i.title}</Link>
              <span className="hint">
                <span className={`type-dot t-${i.type}`} /> {TYPE_LABEL[i.type]}{i.year ? ` · ${i.year}` : ""}{i.rating != null ? ` · ★ ${i.rating}` : ""}
              </span>
              <ListProgress thin percent={i.done * 100} label={i.type === "movie" ? (i.done ? "Watched" : "Not watched") : `${i.watched}/${i.total} episodes`} />
            </div>
            <div className="list-item-actions">
              {list.sort === "manual" && (
                <>
                  <button className="btn small ghost" disabled={busy || idx === 0} onClick={() => move(idx, -1)} aria-label={`Move ${i.title} up`}>↑</button>
                  <button className="btn small ghost" disabled={busy || idx === list.items.length - 1} onClick={() => move(idx, 1)} aria-label={`Move ${i.title} down`}>↓</button>
                </>
              )}
              <button className="btn small ghost" disabled={busy} onClick={() => remove(i)} aria-label={`Remove ${i.title}`}>✕</button>
            </div>
          </li>
        ))}
      </ol>
      {list.items.length === 0 && <p className="hint">Empty for now. Search above, or pick titles on a library page and choose &quot;Add to list&quot;.</p>}
    </div>
  );
}
