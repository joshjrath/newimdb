import Link from "next/link";
import type { WatchingItem } from "@/lib/repo/media";
import { Poster } from "./Poster";
import { ProgressBar } from "./ProgressBar";
import { mediaHref } from "@/lib/domain/links";
import { episodeCode } from "@/lib/domain/progress";
import { TYPE_TO_CATEGORY } from "@/lib/domain/types";

/** Currently Watching: links straight to the active season / next episode. */
export function NowStrip({ items }: { items: WatchingItem[] }) {
  if (!items.length) return null;
  return (
    <section className="now-strip" aria-labelledby="now-h">
      <h2 id="now-h">Currently watching</h2>
      <div className="now-row">
        {items.map((m) => {
          const seg = m.pointer.segment;
          const next = m.pointer.nextEpisode;
          const anchor = next ? `#ep-${next.id}` : seg ? `#seg-${seg.id}` : "";
          return (
            <Link key={m.id} href={`${mediaHref(m)}${seg ? `?segment=${seg.id}` : ""}${anchor}`} className={`now-item cat-${TYPE_TO_CATEGORY[m.type]}`}>
              <Poster url={m.posterUrl} title={m.title} />
              <div>
                <strong>{m.title}</strong>
                <p className="now-next">
                  {next && seg ? (
                    <><b>{episodeCode(seg, next)}</b>Up next{next.title ? ` · ${next.title}` : ""}</>
                  ) : m.pointer.caughtUp ? (
                    <><b>Caught up</b>{seg?.label}</>
                  ) : seg ? (
                    <><b>Start</b>{seg.label}</>
                  ) : (
                    <><b>–</b>No episodes yet</>
                  )}
                </p>
                <ProgressBar p={m.progress} />
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
