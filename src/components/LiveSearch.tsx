"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

/** A search box that filters as you type (a moment after you stop), no Enter needed. */
export function LiveSearch({ placeholder, label, className = "input" }: { placeholder: string; label: string; className?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [value, setValue] = useState(params.get("q") ?? "");
  const [pending, start] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep in step when the address changes another way (Back, a filter chip…).
  useEffect(() => {
    setValue(params.get("q") ?? "");
  }, [params]);

  const push = (q: string) => {
    const next = new URLSearchParams(params.toString());
    next.delete("page");
    if (q.trim()) next.set("q", q.trim());
    else next.delete("q");
    const qs = next.toString();
    start(() => router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false }));
  };

  return (
    <span className={`live-search${pending ? " pending" : ""}`}>
      <input
        className={className}
        type="search"
        name="q"
        value={value}
        placeholder={placeholder}
        aria-label={label}
        autoComplete="off"
        onChange={(e) => {
          setValue(e.target.value);
          if (timer.current) clearTimeout(timer.current);
          const v = e.target.value;
          timer.current = setTimeout(() => push(v), 250);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (timer.current) clearTimeout(timer.current);
            push(value);
          }
        }}
      />
    </span>
  );
}
