"use client";
import { useEffect, useRef, useState } from "react";

export interface SortChoice<K extends string> {
  key: K;
  label: string;
  reverse: string;
  icon: string;
}

/** The styled sort menu plus a ↑↓ reverse button, for state kept on the page (e.g. a list). */
export function SortPicker<K extends string>({ options, value, reversed, onChange }: { options: readonly SortChoice<K>[]; value: K; reversed: boolean; onChange: (key: K, reversed: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.key === value) ?? options[0];
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
  const label = (o: SortChoice<K>, r: boolean) => (r ? o.reverse : o.label);
  return (
    <div className="sort-menu" ref={box}>
      <button type="button" className="sort-trigger" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className={`sort-icon${current.icon === "IMDb" ? " imdb" : ""}`} aria-hidden="true">{current.icon}</span>
        <span>{label(current, reversed)}</span>
        <span className="sort-caret" aria-hidden="true">▾</span>
      </button>
      <button type="button" className="sort-dir" onClick={() => onChange(value, !reversed)} aria-label={`Reverse: ${label(current, !reversed)}`} title={`Reverse: ${label(current, !reversed)}`}>
        <span className={reversed ? "" : "on"}>↑</span>
        <span className={reversed ? "on" : ""}>↓</span>
      </button>
      {open && (
        <ul className="sort-list" role="listbox" aria-label="Sort by">
          {options.map((o) => {
            const active = o.key === value;
            return (
              <li key={o.key} role="option" aria-selected={active}>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    onChange(o.key, active ? reversed : false);
                  }}
                >
                  <span className={`sort-icon${o.icon === "IMDb" ? " imdb" : ""}`} aria-hidden="true">{o.icon}</span>
                  <span className="grow">{label(o, active && reversed)}</span>
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
