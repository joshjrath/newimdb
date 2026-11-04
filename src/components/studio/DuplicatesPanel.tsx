"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import { useAction } from "../useAction";
import { plural } from "@/lib/domain/text";
import type { DuplicateGroup } from "@/lib/repo/duplicates";

export const LIBRARY_CHANGED = "library:changed";
const SOURCE: Record<string, string> = { letterboxd: "Letterboxd", imdb: "IMDb", manual: "added by you", backup: "backup" };

/** Titles that ended up in the library twice, with one button to merge them. */
export function DuplicatesPanel() {
  const router = useRouter();
  const [groups, setGroups] = useState<DuplicateGroup[] | null>(null);
  const { busy, run } = useAction();

  const load = useCallback(async () => {
    try {
      setGroups((await api<{ groups: DuplicateGroup[] }>("/api/duplicates")).groups);
    } catch {}
  }, []);

  useEffect(() => {
    load();
    window.addEventListener(LIBRARY_CHANGED, load);
    return () => window.removeEventListener(LIBRARY_CHANGED, load);
  }, [load]);

  if (!groups?.length) return null;
  const removing = groups.reduce((n, g) => n + g.remove.length, 0);

  const merge = async () => {
    if (!confirm(`Merge ${plural(groups.length, "title", "titles")}? ${plural(removing, "extra copy", "extra copies")} will be folded in and removed. A backup is saved first.`)) return;
    const r = await run(() => api<{ result: { removed: number; backup: string | null }; groups: DuplicateGroup[] }>("/api/duplicates", { body: {} }), {
      ok: (r) => `Merged. Removed ${plural(r.result.removed, "duplicate", "duplicates")}. Backup saved as ${r.result.backup}.`,
    });
    if (r) {
      setGroups(r.groups);
      router.refresh();
    }
  };

  return (
    <section className="panel" aria-labelledby="dupes-h">
      <header>
        <h2 id="dupes-h">Duplicates</h2>
        <span className="hint">Each title should only be reviewed once.</span>
      </header>
      <p className="muted">
        {plural(groups.length, "title is", "titles are")} in your library more than once. Merging keeps one copy (Letterboxd&apos;s when there is one, then yours, then IMDb&apos;s), fills any gaps from the others, and keeps everyone you watched with and every tag.
      </p>
      <ul className="plain-list dupes">
        {groups.slice(0, 100).map((g) => (
          <li key={g.keep.id}>
            <Link href={`/studio/${g.keep.id}`}><b>{g.keep.title}</b></Link> {g.keep.year ?? ""} <span className="hint">keeps the {SOURCE[g.keep.source] ?? g.keep.source} copy, removes {g.remove.map((r) => SOURCE[r.source] ?? r.source).join(", ")}</span>
          </li>
        ))}
      </ul>
      {groups.length > 100 && <p className="hint">…and {groups.length - 100} more.</p>}
      <div>
        <button className="btn primary" disabled={busy} onClick={merge}>{busy ? "Merging…" : `Merge ${plural(groups.length, "title", "titles")}`}</button>
      </div>
    </section>
  );
}
