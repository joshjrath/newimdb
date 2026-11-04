"use client";
import Link from "next/link";
import { useState } from "react";
import { api } from "@/lib/client/api";
import { useAction } from "../useAction";
import { plural } from "@/lib/domain/text";
import type { PersonWithCount } from "@/lib/repo/people";

type Res = { people: PersonWithCount[] };

/** Settings → People: the list you pick from when saying who you watched something with. */
export function PeopleSettings({ initial }: { initial: PersonWithCount[] }) {
  const [people, setPeople] = useState(initial);
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<{ id: number; name: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const { busy, run } = useAction();

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    const r = await run(() => api<Res>("/api/people", { body: { name: n } }), { ok: `Added ${n}.` });
    if (r) {
      setPeople(r.people);
      setName("");
    }
  };

  const rename = async () => {
    if (!editing) return;
    const r = await run(() => api<Res>(`/api/people/${editing.id}`, { method: "PATCH", body: { name: editing.name } }), { ok: "Renamed." });
    if (r) {
      setPeople(r.people);
      setEditing(null);
    }
  };

  const remove = async (p: PersonWithCount) => {
    const r = await run(() => api<Res>(`/api/people/${p.id}`, { method: "DELETE" }), {
      ok: `Removed ${p.name}${p.count ? ` from ${plural(p.count, "title", "titles")}` : ""}. The titles are still in your library.`,
    });
    if (r) setPeople(r.people);
    setConfirmDelete(null);
  };

  return (
    <section className="panel" aria-labelledby="people-h">
      <header>
        <h2 id="people-h">People you watch with</h2>
        <span className="hint">Pick any of them, as many as you like, on a title&apos;s page in Studio.</span>
      </header>

      <form className="toolbar" onSubmit={add}>
        <label className="grow" htmlFor="person-name">
          <span className="visually-hidden">Name</span>
          <input id="person-name" className="input" value={name} maxLength={60} placeholder="Add someone, e.g. Sam" onChange={(e) => setName(e.target.value)} />
        </label>
        <button className="btn primary" disabled={busy || !name.trim()}>Add person</button>
      </form>

      {people.length === 0 ? (
        <p className="hint">Nobody yet. Add the people you watch with, and they&apos;ll show up as options on every movie and show.</p>
      ) : (
        <ul className="people-list">
          {people.map((p) => (
            <li key={p.id}>
              {editing?.id === p.id ? (
                <form
                  className="toolbar grow-row"
                  onSubmit={(e) => {
                    e.preventDefault();
                    rename();
                  }}
                >
                  <label className="grow" htmlFor={`rename-${p.id}`}>
                    <span className="visually-hidden">New name for {p.name}</span>
                    <input id={`rename-${p.id}`} className="input" autoFocus value={editing.name} maxLength={60} onChange={(e) => setEditing({ id: p.id, name: e.target.value })} />
                  </label>
                  <button className="btn small primary" disabled={busy || !editing.name.trim()}>Save</button>
                  <button type="button" className="btn small ghost" onClick={() => setEditing(null)}>Cancel</button>
                </form>
              ) : confirmDelete === p.id ? (
                <div className="toolbar grow-row">
                  <span className="push-right">
                    Remove <b>{p.name}</b>{p.count ? ` from ${plural(p.count, "title", "titles")}` : ""}? The titles stay in your library.
                  </span>
                  <button className="btn small danger" disabled={busy} onClick={() => remove(p)}>Remove</button>
                  <button className="btn small ghost" onClick={() => setConfirmDelete(null)}>Keep</button>
                </div>
              ) : (
                <>
                  <span className="person-avatar" aria-hidden="true">{p.name.slice(0, 1).toUpperCase()}</span>
                  <span className="person-name">{p.name}</span>
                  {p.count > 0 ? (
                    <Link className="hint person-count" href={`/studio?with=${p.id}`}>{plural(p.count, "title", "titles")}</Link>
                  ) : (
                    <span className="hint person-count">No titles yet</span>
                  )}
                  <button className="btn small ghost" onClick={() => setEditing({ id: p.id, name: p.name })}>Rename</button>
                  <button className="btn small ghost" onClick={() => setConfirmDelete(p.id)}>Remove</button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
