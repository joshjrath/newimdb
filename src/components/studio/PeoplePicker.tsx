"use client";
import Link from "next/link";
import { useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import { useToast } from "../Toasts";
import type { PersonRef } from "@/lib/domain/types";

/**
 * "Watched with": tap any number of people (nobody, one, several). Someone new can be
 * added right here; the full list is managed in Settings.
 */
export function PeoplePicker({ all, selected, onChange, onPeople }: { all: PersonRef[]; selected: number[]; onChange: (ids: number[]) => void; onPeople: (p: PersonRef[]) => void }) {
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const toggle = (id: number) => onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);

  const add = async () => {
    const n = name.trim();
    if (!n) return;
    setBusy(true);
    try {
      const r = await api<{ person: PersonRef; people: PersonRef[] }>("/api/people", { body: { name: n } });
      onPeople(r.people);
      onChange([...selected, r.person.id]);
      setName("");
      setAdding(false);
    } catch (e) {
      // Already on the list: just select them.
      const existing = e instanceof ApiError ? Number(e.body.existingId) : NaN;
      if (existing && !selected.includes(existing)) onChange([...selected, existing]);
      else toast.push("error", (e as Error).message);
      if (existing) {
        setName("");
        setAdding(false);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="field">
      <span className="label" id="with-label">Watched with</span>
      <div className="chips with-chips" role="group" aria-labelledby="with-label">
        {all.map((p) => (
          <button key={p.id} type="button" className="chip" aria-pressed={selected.includes(p.id)} onClick={() => toggle(p.id)}>
            {p.name}
          </button>
        ))}
        {adding ? (
          <span className="toolbar" style={{ gap: 4 }}>
            <label htmlFor="new-person">
              <span className="visually-hidden">New person&apos;s name</span>
              <input
                id="new-person"
                className="input small"
                autoFocus
                value={name}
                maxLength={60}
                placeholder="Name"
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    add();
                  }
                  if (e.key === "Escape") setAdding(false);
                }}
              />
            </label>
            <button type="button" className="btn small" disabled={busy || !name.trim()} onClick={add}>Add</button>
          </span>
        ) : (
          <button type="button" className="chip" onClick={() => setAdding(true)}>+ Someone new</button>
        )}
      </div>
      <span className="hint">
        Pick everyone who watched it with you, or nobody. Manage the list in <Link href="/studio/settings">Settings</Link>.
      </span>
    </div>
  );
}
