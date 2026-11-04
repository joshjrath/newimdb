"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { SORT_OPTIONS, naturalDir, sortLabel, type SortDir, type SortKey } from "@/lib/domain/sort";

const ICON: Record<SortKey, string> = { recent: "🕒", rating: "★", title: "Aa", year: "📅", added: "＋", progress: "▰" };

/** Sort picker plus a direction arrow: Recently watched ↔ Oldest watched, and so on. */
export function SortMenu({ sort, dir, exclude = [] }: { sort: SortKey; dir?: SortDir; exclude?: SortKey[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const current = dir ?? naturalDir(sort);
  const options = SORT_OPTIONS.filter((o) => !exclude.includes(o.key));

  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", off);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", off);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const go = (key: SortKey, d: SortDir) => {
    const next = new URLSearchParams(params.toString());
    next.delete("page");
    next.set("sort", key);
    if (d === naturalDir(key)) next.delete("dir");
    else next.set("dir", d);
    setOpen(false);
    router.push(`${pathname}?${next.toString()}`);
  };

  return (
    <div className="sort-menu" ref={box}>
      <button type="button" className="sort-trigger" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="sort-icon" aria-hidden="true">{ICON[sort]}</span>
        <span>{sortLabel(sort, current)}</span>
        <span className="sort-caret" aria-hidden="true">▾</span>
      </button>
      <button
        type="button"
        className="sort-dir"
        onClick={() => go(sort, current === "asc" ? "desc" : "asc")}
        aria-label={`Reverse: ${sortLabel(sort, current === "asc" ? "desc" : "asc")}`}
        title={`Reverse: ${sortLabel(sort, current === "asc" ? "desc" : "asc")}`}
      >
        <span className={current === "asc" ? "on" : ""}>↑</span>
        <span className={current === "desc" ? "on" : ""}>↓</span>
      </button>
      {open && (
        <ul className="sort-list" role="listbox" aria-label="Sort by">
          {options.map((o) => {
            const active = o.key === sort;
            const d = active ? current : (o.natural as SortDir);
            return (
              <li key={o.key} role="option" aria-selected={active}>
                <button type="button" onClick={() => go(o.key, d)}>
                  <span className="sort-icon" aria-hidden="true">{ICON[o.key]}</span>
                  <span className="grow">{sortLabel(o.key, d)}</span>
                  {active && <span aria-hidden="true">✓</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
