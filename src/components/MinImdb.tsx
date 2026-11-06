"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/** Library filter: only titles IMDb rates at least this (e.g. 7.5). Combines with every other filter. */
export function MinImdb({ value }: { value: number | null }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [v, setV] = useState(value ? String(value) : "");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => setV(value ? String(value) : ""), [value]);
  const go = (raw: string) => {
    const n = Number(raw);
    const next = new URLSearchParams(params.toString());
    next.delete("page");
    if (n > 0 && n <= 10) next.set("imdb", String(Math.round(n * 10) / 10));
    else next.delete("imdb");
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };
  return (
    <label className={`chip min-imdb-chip${value ? " on" : ""}`} title="Only titles IMDb rates at least this">
      <span className="imdb-badge"><b>IMDb</b></span>
      <input
        type="number"
        inputMode="decimal"
        min={0}
        max={10}
        step={0.1}
        placeholder="min"
        value={v}
        aria-label="Minimum IMDb rating, out of 10"
        onChange={(e) => {
          setV(e.target.value);
          if (timer.current) clearTimeout(timer.current);
          const raw = e.target.value;
          timer.current = setTimeout(() => go(raw), 350);
        }}
      />
      <span aria-hidden="true">+</span>
    </label>
  );
}
