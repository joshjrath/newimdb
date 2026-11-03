"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/client/api";
import { useToast } from "../Toasts";
import { Stars } from "../Stars";
import { StatusPill } from "../StatusPill";
import { STATUS_LABEL, TYPE_LABEL, WATCH_STATUSES, TYPE_TO_CATEGORY, type MediaType, type WatchStatus } from "@/lib/domain/types";
import { slugify } from "@/lib/domain/text";
import { formatDate } from "@/lib/format";

interface Row {
  id: number; title: string; year: number | null; type: MediaType; posterUrl: string | null; rating: number | null;
  status: WatchStatus | null; featured: boolean; updatedAt: string; source: string; tags: string[]; progress: string | null;
}

export function ManageTable({ items, total, page, pageSize, filters }: { items: Row[]; total: number; page: number; pageSize: number; filters: { type: string; status: string; q: string; sort: string } }) {
  const router = useRouter();
  const toast = useToast();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [tag, setTag] = useState("");
  const all = items.length > 0 && items.every((i) => selected.has(i.id));
  const ids = [...selected];

  const run = async (action: string, extra: Record<string, unknown> = {}, ok?: string) => {
    if (!ids.length) return;
    setBusy(true);
    try {
      const r = await api<{ changed: number }>("/api/media/bulk", { body: { ids, action, ...extra } });
      toast.push("ok", ok ?? `Updated ${r.changed} ${r.changed === 1 ? "entry" : "entries"}.`);
      setSelected(new Set());
      router.refresh();
    } catch (e) {
      toast.push("error", `Not saved: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const pages = Math.max(1, Math.ceil(total / pageSize));
  const qs = (patch: Record<string, string>) => {
    const p = new URLSearchParams(Object.entries({ ...filters, ...patch }).filter(([, v]) => v) as [string, string][]);
    return `/studio?${p}`;
  };

  return (
    <div style={{ display: "grid", gap: 14, gridTemplateColumns: "minmax(0, 1fr)" }}>
      <form className="toolbar" method="get" action="/studio" role="search">
        <label>
          <span className="visually-hidden">Type</span>
          <select className="select" name="type" defaultValue={filters.type} style={{ width: "auto" }}>
            <option value="">All types</option>
            <option value="movie">Movies</option>
            <option value="tv">TV Shows</option>
            <option value="anime">Anime</option>
          </select>
        </label>
        <label>
          <span className="visually-hidden">Status</span>
          <select className="select" name="status" defaultValue={filters.status} style={{ width: "auto" }}>
            <option value="">Any status</option>
            {WATCH_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            <option value="none">No status</option>
          </select>
        </label>
        <label>
          <span className="visually-hidden">Sort</span>
          <select className="select" name="sort" defaultValue={filters.sort} style={{ width: "auto" }}>
            <option value="added">Recently added</option>
            <option value="recent">Recently watched</option>
            <option value="title">Title</option>
            <option value="rating">Rating</option>
          </select>
        </label>
        <label className="grow">
          <span className="visually-hidden">Search</span>
          <input className="input" type="search" name="q" defaultValue={filters.q} placeholder="Search titles and reviews" />
        </label>
        <button className="btn" type="submit">Filter</button>
      </form>

      {selected.size > 0 && (
        <div className="bulkbar" role="region" aria-label="Bulk actions">
          <strong>{selected.size} selected</strong>
          <button className="btn small" disabled={busy} onClick={() => run("feature")}>Feature</button>
          <button className="btn small" disabled={busy} onClick={() => run("unfeature")}>Unfeature</button>
          <label>
            <span className="visually-hidden">Set status</span>
            <select className="select" style={{ width: "auto", padding: "4px 8px" }} disabled={busy} value="" onChange={(e) => e.target.value && run("set_status", { status: e.target.value === "none" ? null : e.target.value })}>
              <option value="">Set status…</option>
              {WATCH_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
              <option value="none">Clear status</option>
            </select>
          </label>
          <span className="toolbar" style={{ gap: 4 }}>
            <input className="input" style={{ width: 130, padding: "4px 8px" }} placeholder="Tag" value={tag} onChange={(e) => setTag(e.target.value)} aria-label="Tag name" />
            <button className="btn small" disabled={busy || !tag.trim()} onClick={() => run("add_tag", { tag: tag.trim() })}>Add tag</button>
            <button className="btn small" disabled={busy || !tag.trim()} onClick={() => run("remove_tag", { tag: tag.trim() })}>Remove tag</button>
          </span>
          <button
            className="btn small danger"
            disabled={busy}
            onClick={() => {
              const n = selected.size;
              if (window.prompt(`Delete ${n} ${n === 1 ? "entry" : "entries"} with all reviews and episode ratings? This can't be undone. Type DELETE to confirm.`) === "DELETE") {
                run("delete", {}, `Deleted ${n} ${n === 1 ? "entry" : "entries"}.`);
              }
            }}
          >
            Delete
          </button>
          <button className="btn small ghost" onClick={() => setSelected(new Set())}>Clear selection</button>
        </div>
      )}

      <div className="table-wrap">
        <table className="manage">
          <thead>
            <tr>
              <th style={{ width: 36 }}>
                <input type="checkbox" aria-label="Select all on this page" checked={all} onChange={() => setSelected(all ? new Set() : new Set(items.map((i) => i.id)))} />
              </th>
              <th>Title</th>
              <th>Type</th>
              <th>My rating</th>
              <th>Status</th>
              <th>Progress</th>
              <th>Updated</th>
              <th><span className="visually-hidden">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {items.map((m) => (
              <tr key={m.id} aria-selected={selected.has(m.id)}>
                <td>
                  <input
                    type="checkbox"
                    aria-label={`Select ${m.title}`}
                    checked={selected.has(m.id)}
                    onChange={() => {
                      const n = new Set(selected);
                      if (n.has(m.id)) n.delete(m.id); else n.add(m.id);
                      setSelected(n);
                    }}
                  />
                </td>
                <td>
                  <Link className="t" href={`/studio/${m.id}`}>{m.title}</Link>
                  {m.year ? <span className="hint"> ({m.year})</span> : null}
                  {m.featured && <span className="hint"> · Featured</span>}
                  {m.tags.length > 0 && <div className="hint">{m.tags.join(", ")}</div>}
                </td>
                <td>{TYPE_LABEL[m.type]}{m.source === "letterboxd" ? <div className="hint">Letterboxd</div> : null}</td>
                <td>{m.rating != null ? <Stars value={m.rating} size={14} /> : <span className="hint">–</span>}</td>
                <td><StatusPill status={m.status} /></td>
                <td className="hint">{m.progress ?? ""}</td>
                <td className="hint">{formatDate(m.updatedAt)}</td>
                <td style={{ whiteSpace: "nowrap" }}>
                  <Link className="btn small ghost" href={`/watch/${TYPE_TO_CATEGORY[m.type]}/${m.id}-${slugify(m.title)}`}>View</Link>
                  <Link className="btn small" href={`/studio/${m.id}`}>Edit</Link>
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr><td colSpan={8} style={{ textAlign: "center", padding: 32 }} className="hint">Nothing here. <Link href="/studio/new">Add a title</Link> or <Link href="/studio/import">import from Letterboxd</Link>.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <nav className="pager" aria-label="Pages">
        {page > 1 && <Link className="btn small" href={qs({ page: String(page - 1) })}>Previous</Link>}
        <span>{total} total · page {page} of {pages}</span>
        {page < pages && <Link className="btn small" href={qs({ page: String(page + 1) })}>Next</Link>}
      </nav>
    </div>
  );
}
