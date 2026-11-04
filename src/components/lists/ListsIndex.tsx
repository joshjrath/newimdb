"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, posterSrc } from "@/lib/client/api";
import { useAction } from "../useAction";
import { ListProgress } from "./ListProgress";
import { plural } from "@/lib/domain/text";
import type { ListSummary } from "@/lib/domain/lists";

/** Lists: your own collections, each with a progress bar. */
export function ListsIndex({ initial }: { initial: ListSummary[] }) {
  const [name, setName] = useState("");
  const { busy, run } = useAction();
  const router = useRouter();
  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await run(() => api<{ id: number }>("/api/lists", { body: { name } }));
    if (r) router.push(`/lists/${r.id}`);
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
      {initial.length === 0 ? (
        <p className="hint">No lists yet. Make one for a franchise (MCU, Star Wars), a mood, or a watchlist with friends. Lists can mix movies, shows and anime.</p>
      ) : (
        <div className="list-grid">
          {initial.map((l) => (
            <Link key={l.id} href={`/lists/${l.id}`} className="list-card">
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
          ))}
        </div>
      )}
    </div>
  );
}
