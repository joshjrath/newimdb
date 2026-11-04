"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import { useAction } from "./useAction";
import { plural } from "@/lib/domain/text";
import type { BulkMediaAction } from "@/lib/schemas";

type Ref = { id: number; name: string };
const KEY = "library-selection";

/**
 * The library grid, plus "Select": tap cards to pick as many as you like (across pages
 * and filters), then tag them all in one go: who you watched with, a tag, a genre, a
 * status, or a list.
 */
export function SelectableGrid({ children, pageIds, people, genres, lists, statuses }: {
  children: React.ReactNode;
  pageIds: number[];
  people: Ref[];
  genres: Ref[];
  lists: Ref[];
  statuses: { key: string; label: string }[];
}) {
  const [on, setOn] = useState(false);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [tag, setTag] = useState("");
  const grid = useRef<HTMLDivElement>(null);
  const { busy, run } = useAction();
  const router = useRouter();

  // Keep the selection while you page or filter.
  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(KEY) ?? "null");
      if (saved?.on) {
        setOn(true);
        setSel(new Set(saved.ids));
      }
    } catch {}
  }, []);
  useEffect(() => {
    try {
      sessionStorage.setItem(KEY, JSON.stringify({ on, ids: [...sel] }));
    } catch {}
    grid.current?.querySelectorAll<HTMLElement>("[data-select-id]").forEach((el) => {
      el.classList.toggle("selected", sel.has(Number(el.dataset.selectId)));
      el.setAttribute("aria-selected", on ? String(sel.has(Number(el.dataset.selectId))) : "false");
    });
  }, [sel, on, children]);

  const toggle = (id: number) => setSel((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });

  const onClickCapture = (e: React.MouseEvent) => {
    if (!on) return;
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-select-id]");
    if (!el) return;
    e.preventDefault();
    e.stopPropagation();
    toggle(Number(el.dataset.selectId));
  };

  const ids = [...sel];
  const bulk = async (action: BulkMediaAction, extra: Record<string, unknown>, ok: string) => {
    const r = await run(() => api<{ changed: number }>("/api/media/bulk", { body: { ids, action, ...extra } }), { ok });
    if (r) router.refresh();
  };
  const toList = async (listId: number, name: string) => {
    const r = await run(() => api<{ added: number }>(`/api/lists/${listId}/items`, { body: { mediaIds: ids } }), { ok: (x) => `Added ${plural(x.added, "title", "titles")} to ${name}.` });
    if (r) router.refresh();
  };
  const newList = async () => {
    const name = window.prompt("Name for the new list");
    if (!name?.trim()) return;
    const r = await run(() => api<{ id: number }>("/api/lists", { body: { name: name.trim(), mediaIds: ids } }), { ok: `Made "${name.trim()}" with ${plural(ids.length, "title", "titles")}.` });
    if (r) router.refresh();
  };
  const what = plural(ids.length, "title", "titles");

  return (
    <>
      <div className="select-toggle">
        <button className={`btn small${on ? " primary" : ""}`} onClick={() => { setOn(!on); if (on) setSel(new Set()); }} aria-pressed={on}>
          {on ? "Done selecting" : "Select"}
        </button>
        {on && (
          <>
            <button className="btn small ghost" onClick={() => setSel(new Set([...sel, ...pageIds]))}>Select all on this page</button>
            {sel.size > 0 && <button className="btn small ghost" onClick={() => setSel(new Set())}>Clear</button>}
            <span className="hint">Tap titles to pick them. Your picks stay while you change pages or filters.</span>
          </>
        )}
      </div>
      <div ref={grid} className={`library${on ? " selecting" : ""}`} onClickCapture={onClickCapture}>
        {children}
      </div>
      {on && sel.size > 0 && (
        <div className="select-bar" role="region" aria-label="Change selected titles">
          <b>{what} selected</b>
          {people.length > 0 && (
            <div className="select-group">
              <span className="label">Watched with</span>
              {people.map((p) => (
                <button key={p.id} className="chip" disabled={busy} onClick={() => bulk("add_person", { personId: p.id }, `Watched with ${p.name}: ${what}.`)} title={`Add ${p.name} to all ${what}`}>
                  + {p.name}
                </button>
              ))}
            </div>
          )}
          <div className="select-group">
            <span className="label">Tag</span>
            <input className="input small" value={tag} placeholder="e.g. Comfort" onChange={(e) => setTag(e.target.value)} onKeyDown={(e) => e.key === "Enter" && tag.trim() && bulk("add_tag", { tag: tag.trim() }, `Tagged ${what} “${tag.trim()}”.`)} />
            <button className="btn small" disabled={busy || !tag.trim()} onClick={() => bulk("add_tag", { tag: tag.trim() }, `Tagged ${what} “${tag.trim()}”.`)}>Add</button>
          </div>
          {genres.length > 0 && (
            <select className="select small" disabled={busy} value="" onChange={(e) => { const g = genres.find((x) => x.id === Number(e.target.value)); if (g) bulk("add_genre", { genreId: g.id }, `Added ${g.name} to ${what}.`); }}>
              <option value="">+ Genre…</option>
              {genres.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          )}
          <select className="select small" disabled={busy} value="" onChange={(e) => { const v = e.target.value; if (v) bulk("set_status", { status: v === "none" ? null : v }, `Status changed on ${what}.`); }}>
            <option value="">Status…</option>
            {statuses.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            <option value="none">No status</option>
          </select>
          <select className="select small" disabled={busy} value="" onChange={(e) => { const v = e.target.value; if (v === "new") newList(); else { const l = lists.find((x) => x.id === Number(v)); if (l) toList(l.id, l.name); } }}>
            <option value="">+ List…</option>
            {lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            <option value="new">New list…</option>
          </select>
          {people.length > 0 && (
            <select className="select small" disabled={busy} value="" onChange={(e) => { const p = people.find((x) => x.id === Number(e.target.value)); if (p) bulk("remove_person", { personId: p.id }, `Removed ${p.name} from ${what}.`); }}>
              <option value="">Remove person…</option>
              {people.map((p) => <option key={p.id} value={p.id}>− {p.name}</option>)}
            </select>
          )}
        </div>
      )}
    </>
  );
}
