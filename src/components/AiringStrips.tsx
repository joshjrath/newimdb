import Link from "next/link";
import type { AiringItem, UpcomingItem } from "@/lib/repo/media";
import { Poster } from "./Poster";
import { mediaHref } from "@/lib/domain/links";
import { episodeCode } from "@/lib/domain/progress";

const DAY = 86_400_000;
/** "Today", "Tomorrow", "Fri 14 Nov", or "14 Nov 2027" when it's not this year. */
export function airLabel(date: string | null, today = new Date().toISOString().slice(0, 10)): string {
  if (!date) return "Date TBA";
  const d = new Date(date + "T12:00:00Z");
  const days = Math.round((d.getTime() - new Date(today + "T12:00:00Z").getTime()) / DAY);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  const sameYear = date.slice(0, 4) === today.slice(0, 4);
  return d.toLocaleDateString("en-GB", { timeZone: "UTC", ...(days > 0 && days < 7 ? { weekday: "short" } : {}), day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) });
}

/** Currently airing: a season on air right now, with the next episode and when it airs. */
export function AiringStrip({ items }: { items: AiringItem[] }) {
  if (!items.length) return null;
  return (
    <section className="returning-strip airing-strip" aria-labelledby="airing-h">
      <h2 id="airing-h">
        Currently airing <span className="hint">Leaves when the finale airs, back when the next season starts</span>
      </h2>
      <div className="now-row">
        {items.map((m) => {
          const a = m.airing;
          return (
            <Link key={m.id} href={`${mediaHref(m)}?segment=${a.segment.id}#ep-${a.nextEpisode.id}`} className="returning-item airing">
              <Poster url={m.posterUrl} title={m.title} />
              <div>
                <span className="returning-flag live">On air</span>
                <strong>{m.title}</strong>
                <p className="now-next">
                  <b>{episodeCode(a.segment, a.nextEpisode)}</b>
                  Next: {airLabel(a.nextAirDate)} · {a.aired} of {a.total} out
                </p>
                <div className="air-track" aria-hidden="true"><span style={{ width: `${Math.round((a.aired / a.total) * 100)}%` }} /></div>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

/** Upcoming: shows you've added that haven't premiered yet. */
export function UpcomingStrip({ items }: { items: UpcomingItem[] }) {
  if (!items.length) return null;
  return (
    <section className="returning-strip" aria-labelledby="upcoming-h">
      <h2 id="upcoming-h">
        Upcoming <span className="hint">Added, not out yet</span>
      </h2>
      <div className="now-row">
        {items.map((m) => {
          const u = m.upcoming;
          return (
            <Link key={m.id} href={mediaHref(m)} className="returning-item announced">
              <Poster url={m.posterUrl} title={m.title} />
              <div>
                <span className="returning-flag">Premieres</span>
                <strong>{m.title}</strong>
                <p className="now-next">
                  <b>{u.premiere ? airLabel(u.premiere) : u.year ?? "TBA"}</b>
                  {u.premiere ? "First episode" : u.year ? "Exact date to be announced" : "Date to be announced"}
                </p>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
