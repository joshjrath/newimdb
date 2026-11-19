"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, posterSrc } from "@/lib/client/api";
import { useAction } from "../useAction";
import { useToast } from "../Toasts";
import { ListProgress } from "./ListProgress";
import { plural } from "@/lib/domain/text";
import type { ListSummary } from "@/lib/domain/lists";

const LAYOUT_KEY = "lists-layout";
/** Ways to see your lists, like the library's layouts. */
const LAYOUTS = [
  { key: "cards", label: "Cards", icon: "▦", hint: "Collage, name and progress" },
  { key: "wall", label: "Poster wall", icon: "▤", hint: "Just the collages, many per row" },
  { key: "big", label: "Big posters", icon: "▣", hint: "Large collages with details below" },
  { key: "list", label: "List", icon: "☰", hint: "One row per list" },
] as const;
type Layout = (typeof LAYOUTS)[number]["key"];

/** Lists: your own collections, each with a progress bar, in your own order. */
export function ListsIndex({ initial }: { initial: ListSummary[] }) {
  const [name, setName] = useState("");
  const [lists, setLists] = useState(initial);
  const [layout, setLayout] = useState<Layout>("cards");
  const [arranging, setArranging] = useState(false);
  const [drag, setDrag] = useState<number | null>(null);
  const { busy, run } = useAction();
  const toast = useToast();
  const router = useRouter();
  useEffect(() => setLists(initial), [initial]);
  useEffect(() => {
    try {
      const v = localStorage.getItem(LAYOUT_KEY);
      if (v && LAYOUTS.some((l) => l.key === v)) setLayout(v as Layout);
    } catch {}
  }, []);
  const pickLayout = (l: Layout) => {
    setLayout(l);
    try {
      localStorage.setItem(LAYOUT_KEY, l);
    } catch {}
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await run(() => api<{ id: number }>("/api/lists", { body: { name } }));
    if (r) router.push(`/lists/${r.id}`);
  };
  const reorder = (next: ListSummary[]) => {
    setLists(next);
    api("/api/lists", { method: "PUT", body: { order: next.map((l) => l.id) } }).catch((e) => toast.push("error", `Order not saved: ${(e as Error).message}`));
  };
  const move = (from: number, to: number) => {
    if (to < 0 || to >= lists.length || from === to) return;
    const next = [...lists];
    const [x] = next.splice(from, 1);
    next.splice(to, 0, x);
    reorder(next);
  };

  return (
    <div className="stack">
      <form className="toolbar panel" onSubmit={create}>
        <label className="grow" htmlFor="new-list">
          <span className="visually-hidden">New list name</span>
          <input id="new-list" className="input" value={name} maxLength={80} placeholder="New list, e.g. MCU in story order" onChange={(e) => setName(e.target.value)} />
        </label>
        <button className="btn primary" disabled={busy || !name.trim()}>Create list</button>
      </form>
      {lists.length === 0 ? (
        <p className="hint">No lists yet. Make one for a franchise (MCU, Star Wars), a mood, or a watchlist with friends. Lists can mix movies, shows and anime.</p>
      ) : (
        <>
          <div className="select-toggle">
            <button className={`btn small${arranging ? " primary" : ""}`} aria-pressed={arranging} onClick={() => setArranging((a) => !a)} disabled={lists.length < 2}>
              {arranging ? "Done reordering" : "⇅ Reorder"}
            </button>
            {arranging && <span className="hint">Drag lists into place, or use the arrows. Saved as you go.</span>}
            <div className="layout-pick" role="radiogroup" aria-label="Layout">
              {LAYOUTS.map((l) => (
                <button key={l.key} type="button" role="radio" aria-checked={layout === l.key} title={`${l.label}: ${l.hint}`} aria-label={l.label} onClick={() => pickLayout(l.key)}>
                  <span aria-hidden="true">{l.icon}</span>
                  <span className="layout-name">{l.label}</span>
                </button>
              ))}
            </div>
          </div>
          <div className={`list-grid lists-${layout}${arranging ? " arranging" : ""}`}>
            {lists.map((l, idx) => (
              <div
                key={l.id}
                className={`list-card-wrap${drag === idx ? " dragging" : ""}`}
                draggable={arranging}
                onDragStart={(e) => {
                  setDrag(idx);
                  e.dataTransfer.effectAllowed = "move";
                }}
                onDragOver={(e) => arranging && e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (drag != null) move(drag, idx);
                  setDrag(null);
                }}
                onDragEnd={() => setDrag(null)}
              >
                <Link href={`/lists/${l.id}`} className="list-card" draggable={false} onClick={(e) => arranging && e.preventDefault()} aria-disabled={arranging || undefined}>
                  <div className="list-collage" aria-hidden="true">
                    {[0, 1, 2, 3].map((i) => (
                      <span key={i} style={l.posters[i] ? { backgroundImage: `url(${posterSrc(l.posters[i])})` } : undefined} />
                    ))}
                  </div>
                  <div className="list-card-body">
                    <h2>{l.name}</h2>
                    <p className="hint">{plural(l.count, "title", "titles")} · {l.finished} finished</p>
                    <ListProgress percent={l.percent} label={`${l.percent}%`} />
                  </div>
                </Link>
                {arranging && (
                  <div className="list-arrange">
                    <span className="list-pos">{idx + 1}</span>
                    <button type="button" className="btn small" onClick={() => move(idx, idx - 1)} disabled={idx === 0} aria-label={`Move ${l.name} earlier`}>↑</button>
                    <button type="button" className="btn small" onClick={() => move(idx, idx + 1)} disabled={idx === lists.length - 1} aria-label={`Move ${l.name} later`}>↓</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
