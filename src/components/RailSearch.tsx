"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import { Poster } from "./Poster";
import { mediaHref } from "@/lib/domain/links";
import { TYPE_LABEL, type MediaType } from "@/lib/domain/types";

type Hit = { id: number; type: MediaType; title: string; year: number | null; posterUrl: string | null };

/** The search in the side rail: results appear as you type; Enter opens them all in Studio. */
export function RailSearch() {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLFormElement>(null);
  const router = useRouter();

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) return setHits(null);
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      try {
        setHits((await api<{ items: Hit[] }>(`/api/media?q=${encodeURIComponent(term)}&pageSize=8&sort=recent`, { signal: ctl.signal })).items);
      } catch {}
    }, 180);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [q]);

  useEffect(() => {
    const off = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", off);
    return () => document.removeEventListener("mousedown", off);
  }, []);

  return (
    <form
      ref={box}
      className="search rail-search"
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        if (q.trim()) router.push(`/studio?q=${encodeURIComponent(q.trim())}`);
        setOpen(false);
      }}
    >
      <input
        type="search"
        value={q}
        placeholder="Search…"
        aria-label="Search every title and review"
        autoComplete="off"
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
      />
      {open && hits && (
        <ul className="rail-hits">
          {hits.length === 0 ? (
            <li className="hint" style={{ padding: 10 }}>Nothing found.</li>
          ) : (
            hits.map((h) => (
              <li key={h.id}>
                <Link href={mediaHref(h)} onClick={() => setOpen(false)}>
                  <Poster url={h.posterUrl} title={h.title} />
                  <span>{h.title}<small>{TYPE_LABEL[h.type]}{h.year ? ` · ${h.year}` : ""}</small></span>
                </Link>
              </li>
            ))
          )}
          {hits.length > 0 && (
            <li>
              <Link className="rail-hits-all" href={`/studio?q=${encodeURIComponent(q.trim())}`} onClick={() => setOpen(false)}>See all results →</Link>
            </li>
          )}
        </ul>
      )}
    </form>
  );
}
