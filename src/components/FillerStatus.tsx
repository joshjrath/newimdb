"use client";
import { useState } from "react";
import { api } from "@/lib/client/api";
import { useAction } from "./useAction";
import type { FillerNote } from "@/lib/anime/filler";

/** Anime: where filler marks come from, a "check now", and a way to point at the right page. */
export function FillerStatus({ mediaId, initial }: { mediaId: number; initial: FillerNote | null }) {
  const [note, setNote] = useState(initial);
  const [page, setPage] = useState("");
  const [editing, setEditing] = useState(false);
  const { busy, run } = useAction();

  const check = async (withPage?: string) => {
    const r = await run(() => api<{ note: FillerNote | null; marked: number }>(`/api/media/${mediaId}/filler`, { body: withPage ? { page: withPage } : {} }));
    if (!r) return;
    setNote(r.note);
    if (r.marked > 0) window.location.reload(); // show the new filler marks in the grid
  };

  const text = !note
    ? "Filler hasn't been checked on animefillerlist.com yet."
    : note.error
      ? note.error
      : note.slug
        ? `Filler from animefillerlist.com (${note.slug})${note.filler ? `: ${note.filler} marked` : ": none to mark"}.`
        : "animefillerlist.com doesn't list this anime (most short series have no filler).";

  return (
    <div className="filler-status">
      <span className={note?.error ? "notice small" : "hint"}>{text}</span>
      <button type="button" className="btn small" disabled={busy} onClick={() => check()}>{busy ? "Checking…" : "Check filler now"}</button>
      <button type="button" className="btn small ghost" onClick={() => setEditing(!editing)} aria-expanded={editing}>Use a specific page</button>
      {editing && (
        <form
          className="toolbar"
          onSubmit={(e) => {
            e.preventDefault();
            if (page.trim()) check(page.trim());
          }}
        >
          <input className="input small grow" value={page} placeholder="https://www.animefillerlist.com/shows/my-hero-academia" onChange={(e) => setPage(e.target.value)} aria-label="animefillerlist.com page for this anime" />
          <button className="btn small primary" disabled={busy || !page.trim()}>Use this page</button>
        </form>
      )}
    </div>
  );
}
