import Link from "next/link";
import type { ReturningItem } from "@/lib/repo/media";
import { Poster } from "./Poster";
import { mediaHref } from "@/lib/domain/links";
import { segmentCode } from "@/lib/domain/progress";
import { formatDate } from "@/lib/format";
import { plural } from "@/lib/domain/text";

/** "New seasons": shows you'd finished that are back. Links straight to the new season. */
export function ReturningStrip({ items }: { items: ReturningItem[] }) {
  if (!items.length) return null;
  return (
    <section className="returning-strip" aria-labelledby="returning-h">
      <h2 id="returning-h">
        New seasons <span className="hint">Shows you finished that are back</span>
      </h2>
      <div className="now-row">
        {items.map((m) => {
          const r = m.returning;
          const more = r.newSegments.length - 1;
          return (
            <Link key={m.id} href={`${mediaHref(m)}?segment=${r.segment.id}#seg-${r.segment.id}`} className={`returning-item ${r.state}`}>
              <Poster url={m.posterUrl} title={m.title} />
              <div>
                <span className="returning-flag">{r.state === "out" ? "New season out" : "Announced"}</span>
                <strong>{m.title}</strong>
                <p className="now-next">
                  <b>{segmentCode(r.segment)}</b>
                  {r.state === "out"
                    ? `${plural(r.airedEpisodes, "episode", "episodes")} to watch${more > 0 ? ` · +${plural(more, "more season", "more seasons")}` : ""}`
                    : r.nextAirDate
                      ? `Starts ${formatDate(r.nextAirDate)}`
                      : "Date to be announced"}
                </p>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
