import Link from "next/link";
import type { ListItem } from "@/lib/repo/media";
import { excerpt } from "@/lib/domain/text";
import { mediaHref } from "@/lib/domain/links";
import { Stars } from "./Stars";
import { StatusPill } from "./StatusPill";
import { Poster } from "./Poster";
import { ProgressBar } from "./ProgressBar";
import { formatDate } from "@/lib/format";
import { segmentCode, type Returning } from "@/lib/domain/progress";

export function LibraryCard({ m, returning, showType }: { m: ListItem; returning?: Returning; /** All Media: say what kind it is. */ showType?: boolean }) {
  const r = m.review;
  return (
    <article className="card">
      {returning && (
        <Link
          className={`card-new-season ${returning.state}`}
          href={`${mediaHref(m)}?segment=${returning.segment.id}#seg-${returning.segment.id}`}
          title={returning.state === "out" ? "A new season is out since you finished" : "A new season has been announced"}
        >
          {returning.state === "out" ? "New" : "Soon"} · {segmentCode(returning.segment)}
        </Link>
      )}
      <Poster url={m.posterUrl} title={m.title} />
      <div className="card-body">
        <h3 className="card-title">
          <Link href={mediaHref(m)}>{m.title}</Link>
        </h3>
        <div className="card-meta">
          {showType && <span className={`kind-tag t-${m.type}`}>{m.type === "movie" ? "Movie" : m.type === "tv" ? "TV" : "Anime"}</span>}
          {m.year && <span>{m.year}</span>}
          <Stars value={r.rating} />
          <StatusPill status={r.status} />
        </div>
        {m.imdb && (
          <div className="card-imdb">
            <span className="imdb-badge" title={m.imdb.votes ? `${m.imdb.votes.toLocaleString("en-GB")} votes on IMDb` : "IMDb rating"}>
              <b>IMDb</b> {m.imdb.rating.toFixed(1)}
            </span>
          </div>
        )}
        {r.body &&
          (r.spoiler ? (
            <p className="card-excerpt spoiler">Contains spoilers. Open to read.</p>
          ) : (
            <p className="card-excerpt">{excerpt(r.body, 70)}</p>
          ))}
        {m.progress && <ProgressBar p={m.progress} />}
        <div className="card-meta">
          {r.watchedIn && <span className={`where-badge ${r.watchedIn}`}>{r.watchedIn === "theater" ? "🎬 Theater" : "📺 Streaming"}</span>}
          {r.watchedOn && <span>Watched {formatDate(r.watchedOn)}</span>}
          {m.people.length > 0 && <span>With {m.people.map((p) => p.name).join(", ")}</span>}
          {m.tags.length > 0 && <span className="tags">{m.tags.join(", ")}</span>}
        </div>
      </div>
    </article>
  );
}
