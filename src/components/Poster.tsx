"use client";
import { useState } from "react";
import { posterSrc } from "@/lib/client/api";

export function Poster({ url, title, contain, priority }: { url: string | null; title: string; contain?: boolean; priority?: boolean }) {
  const [failed, setFailed] = useState(false);
  const src = posterSrc(url);
  return (
    <div className={`poster${contain ? " contain" : ""}`}>
      {src && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={`Poster for ${title}`} loading={priority ? "eager" : "lazy"} decoding="async" onError={() => setFailed(true)} />
      ) : (
        <div className="poster-fallback" aria-label={`${title} (no poster)`}>{title}</div>
      )}
    </div>
  );
}
