import Link from "next/link";
import type { ListItem } from "@/lib/repo/media";
import { TYPE_TO_CATEGORY } from "@/lib/domain/types";
import { excerpt, slugify } from "@/lib/domain/text";
import { Stars } from "./Stars";
import { StatusPill } from "./StatusPill";
import { Poster } from "./Poster";
import { ProgressBar } from "./ProgressBar";
import { formatDate } from "@/lib/format";

export function mediaHref(m: { id: number; type: ListItem["type"]; title: string }) {
  return `/watch/${TYPE_TO_CATEGORY[m.type]}/${m.id}-${slugify(m.title)}`;
}

export function LibraryCard({ m }: { m: ListItem }) {
  const r = m.review;
  return (
    <article className="card">
      <Poster url={m.posterUrl} title={m.title} />
      <div className="card-body">
        <h3 className="card-title">
          <Link href={mediaHref(m)}>{m.title}</Link>
        </h3>
        <div className="card-meta">
          {m.year && <span>{m.year}</span>}
          <Stars value={r.rating} />
          <StatusPill status={r.status} />
        </div>
        {r.body &&
          (r.spoiler ? (
            <p className="card-excerpt spoiler">Contains spoilers. Open to read.</p>
          ) : (
            <p className="card-excerpt">{excerpt(r.body, 70)}</p>
          ))}
        {m.progress && m.progress.total > 0 && <ProgressBar p={m.progress} />}
        <div className="card-meta">
          {r.watchedOn && <span>Watched {formatDate(r.watchedOn)}</span>}
          {m.tags.length > 0 && <span className="tags">{m.tags.join(", ")}</span>}
        </div>
      </div>
    </article>
  );
}
