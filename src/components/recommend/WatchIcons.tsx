import { posterSrc } from "@/lib/client/api";
import type { WatchOption } from "@/lib/providers/tmdb";

const KIND: Record<WatchOption["kind"], string> = { stream: "Stream", free: "Free", ads: "Free with ads", rent: "Rent", buy: "Buy" };

/** Where to watch: one logo per service (Netflix, Hulu, Apple TV+…), linking out. */
export function WatchIcons({ options, size = 30, max = 6 }: { options: WatchOption[]; size?: number; max?: number }) {
  if (!options.length) return <span className="watch-none">Not streaming in your region</span>;
  const shown = options.slice(0, max);
  return (
    <ul className="watch-icons" aria-label="Where to watch">
      {shown.map((o) => {
        const src = posterSrc(o.logoUrl);
        const label = `${o.name}${o.kind !== "stream" ? ` (${KIND[o.kind]})` : ""}`;
        return (
          <li key={o.name}>
            <a href={o.url ?? undefined} target="_blank" rel="noopener noreferrer" title={label} aria-label={label} className={`watch-icon ${o.kind}${o.color ? " tinted" : ""}`} style={{ width: size, height: size, background: o.color ?? undefined }}>
              {src ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={src} alt="" loading="lazy" />
              ) : (
                <span>{o.name.replace(/[^A-Za-z0-9+]/g, "").slice(0, 2)}</span>
              )}
            </a>
          </li>
        );
      })}
      {options.length > max && <li className="watch-more">+{options.length - max}</li>}
    </ul>
  );
}
