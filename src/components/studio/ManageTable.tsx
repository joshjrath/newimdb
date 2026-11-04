"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/client/api";
import { useAction } from "../useAction";
import { Stars } from "../Stars";
import { StatusPill } from "../StatusPill";
import { StatusOptions, TypeOptions } from "../Options";
import { pageCount, Pager } from "../Pager";
import { TYPE_LABEL, type MediaType, type PersonRef, type WatchStatus } from "@/lib/domain/types";
import { mediaHref } from "@/lib/domain/links";
import { plural } from "@/lib/domain/text";
import { formatDate } from "@/lib/format";
import { SORT_OPTIONS } from "@/lib/domain/sort";
import type { BulkMediaAction } from "@/lib/schemas";

interface Row {
  id: number;
  title: string;
  year: number | null;
  type: MediaType;
  rating: number | null;
  status: WatchStatus | null;
  featured: boolean;
  updatedAt: string;
  source: string;
  tags: string[];
  people: string[];
  progress: string | null;
}

export function ManageTable({ items, total, page, pageSize, filters, people }: { items: Row[]; total: number; page: number; pageSize: number; filters: Record<"type" | "status" | "q" | "sort" | "with", string>; people: PersonRef[] }) {
  const router = useRouter();
  const { busy, run } = useAction();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [tag, setTag] = useState("");
  const all = items.length > 0 && items.every((i) => selected.has(i.id));

  const bulk = async (action: BulkMediaAction, extra: Record<string, unknown> = {}, ok?: string) => {
    const r = await run(() => api<{ changed: number }>("/api/media/bulk", { body: { ids: [...selected], action, ...extra } }), {
      ok: (r) => ok ?? `Updated ${plural(r.changed, "entry", "entries")}.`,
      errorPrefix: "Not saved: ",
    });
    if (r) {
      setSelected(new Set());
      router.refresh();
    }
  };

  const toggle = (id: number) =>
    setSelected((cur) => {
      const n = new Set(cur);
      if (!n.delete(id)) n.add(id);
      return n;
    });

  const pageHref = (p: number) => `/studio?${new URLSearchParams(Object.entries({ ...filters, page: String(p) }).filter(([, v]) => v))}`;

  return (
    <div className="stack">
      <form className="toolbar" method="get" action="/studio" role="search">
        <label>
          <span className="visually-hidden">Type</span>
          <select className="select small" name="type" defaultValue={filters.type}>
            <option value="">All types</option>
            <TypeOptions />
          </select>
        </label>
        <label>
          <span className="visually-hidden">Status</span>
          <select className="select small" name="status" defaultValue={filters.status}>
            <option value="">Any status</option>
            <StatusOptions />
            <option value="none">No status</option>
          </select>
        </label>
        <label>
          <span className="visually-hidden">Sort</span>
          <select className="select small" name="sort" defaultValue={filters.sort}>
            {SORT_OPTIONS.map((s) => (
              <option key={s.key} value={s.key}>{s.label}</option>
            ))}
          </select>
        </label>
        {filters.with && <input type="hidden" name="with" value={filters.with} />}
        <label className="grow">
          <span className="visually-hidden">Search</span>
          <input className="input" type="search" name="q" defaultValue={filters.q} placeholder="Search titles and reviews" />
        </label>
        <button className="btn" type="submit">Filter</button>
      </form>

      {selected.size > 0 && (
        <div className="bulkbar" role="region" aria-label="Bulk actions">
          <strong>{selected.size} selected</strong>
          <button className="btn small" disabled={busy} onClick={() => bulk("feature")}>Feature</button>
          <button className="btn small" disabled={busy} onClick={() => bulk("unfeature")}>Unfeature</button>
          <label>
            <span className="visually-hidden">Set status</span>
            <select className="select small" disabled={busy} value="" onChange={(e) => e.target.value && bulk("set_status", { status: e.target.value === "none" ? null : e.target.value })}>
              <option value="">Set status…</option>
              <StatusOptions />
              <option value="none">Clear status</option>
            </select>
          </label>
          <span className="toolbar" style={{ gap: 4 }}>
            <input className="input small" style={{ width: 130 }} placeholder="Tag" value={tag} onChange={(e) => setTag(e.target.value)} aria-label="Tag name" />
            <button className="btn small" disabled={busy || !tag.trim()} onClick={() => bulk("add_tag", { tag: tag.trim() })}>Add tag</button>
            <button className="btn small" disabled={busy || !tag.trim()} onClick={() => bulk("remove_tag", { tag: tag.trim() })}>Remove tag</button>
          </span>
          {people.length > 0 && (
            <label>
              <span className="visually-hidden">Watched with</span>
              <select
                className="select small"
                disabled={busy}
                value=""
                onChange={(e) => {
                  const [act, id] = e.target.value.split(":");
                  if (id) bulk(act === "add" ? "add_person" : "remove_person", { personId: Number(id) });
                }}
              >
                <option value="">Watched with…</option>
                <optgroup label="Add">
                  {people.map((p) => <option key={`a${p.id}`} value={`add:${p.id}`}>+ {p.name}</option>)}
                </optgroup>
                <optgroup label="Remove">
                  {people.map((p) => <option key={`r${p.id}`} value={`remove:${p.id}`}>− {p.name}</option>)}
                </optgroup>
              </select>
            </label>
          )}
          <button
            className="btn small danger"
            disabled={busy}
            onClick={() => {
              const what = plural(selected.size, "entry", "entries");
              if (window.prompt(`Delete ${what} with all reviews and episode ratings? This can't be undone. Type DELETE to confirm.`) === "DELETE") {
                bulk("delete", {}, `Deleted ${what}.`);
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
                  <input type="checkbox" aria-label={`Select ${m.title}`} checked={selected.has(m.id)} onChange={() => toggle(m.id)} />
                </td>
                <td>
                  <Link className="t" href={`/studio/${m.id}`}>{m.title}</Link>
                  {m.year ? <span className="hint"> ({m.year})</span> : null}
                  {m.featured && <span className="hint"> · Featured</span>}
                  {(m.people.length > 0 || m.tags.length > 0) && (
                    <div className="hint">{[m.people.length ? `With ${m.people.join(", ")}` : "", m.tags.join(", ")].filter(Boolean).join(" · ")}</div>
                  )}
                </td>
                <td>{TYPE_LABEL[m.type]}{m.source === "letterboxd" ? <div className="hint">Letterboxd</div> : null}</td>
                <td>{m.rating != null ? <Stars value={m.rating} size={14} /> : <span className="hint">–</span>}</td>
                <td><StatusPill status={m.status} /></td>
                <td className="hint">{m.progress ?? ""}</td>
                <td className="hint">{formatDate(m.updatedAt)}</td>
                <td style={{ whiteSpace: "nowrap" }}>
                  <Link className="btn small ghost" href={mediaHref(m)}>View</Link>
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
      <Pager page={page} pages={pageCount(total, pageSize)} href={pageHref} label={`${total} total`} />
    </div>
  );
}
