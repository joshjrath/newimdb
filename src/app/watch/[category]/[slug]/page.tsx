import { Fragment } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { loadOwnerMedia, requireOwnerPage } from "@/lib/guard";
import { Shell } from "@/components/Shell";
import { Poster } from "@/components/Poster";
import { Stars } from "@/components/Stars";
import { StatusPill } from "@/components/StatusPill";
import { EpisodesSection } from "@/components/EpisodesSection";
import { ShareDialog } from "@/components/ShareDialog";
import { SpoilerReveal, CopyLink } from "@/components/DetailClient";
import { mediaHref } from "@/lib/domain/links";
import { idFromSlug, paragraphs } from "@/lib/domain/text";
import { CATEGORY_LABEL, TYPE_TO_CATEGORY, type MediaDetail } from "@/lib/domain/types";
import { formatDate } from "@/lib/format";

type Params = Promise<{ category: string; slug: string }>;

export async function generateMetadata({ params }: { params: Params }) {
  const m = await loadOwnerMedia(idFromSlug((await params).slug));
  return { title: m?.title ?? "Watch" };
}

/** Third-party facts, kept apart from the owner's own rating and review. */
function aboutRows(m: MediaDetail): [string, string][] {
  const rows: [string, string | number | null | false][] = [
    ["Genres", m.genres.join(", ")],
    [`${m.thirdPartyRatingSource ?? "Public"} score`, m.thirdPartyRating != null && `${m.thirdPartyRating.toFixed(1)} / 10 (not my rating)`],
    ["IMDb", m.imdbId],
    ["TMDB", m.tmdbId],
    ["MyAnimeList", m.malId],
    ["TVmaze", m.tvmazeId],
    ["Source", m.review.source === "letterboxd" && "Imported from Letterboxd"],
    ["Details from", m.metadataSource !== "letterboxd" && m.metadataSource],
  ];
  return rows.filter((r): r is [string, string | number] => r[1] != null && r[1] !== false && r[1] !== "").map(([k, v]) => [k, String(v)]);
}

export default async function DetailPage({ params, searchParams }: { params: Params; searchParams: Promise<{ segment?: string }> }) {
  const { category, slug } = await params;
  await requireOwnerPage(`/watch/${category}/${slug}`);
  const m = await loadOwnerMedia(idFromSlug(slug));
  if (!m) notFound();
  const canonical = mediaHref(m);
  if (canonical !== `/watch/${category}/${slug}`) redirect(canonical);
  const r = m.review;
  const cat = TYPE_TO_CATEGORY[m.type];
  const about = aboutRows(m);

  const body = r.body.trim() ? (
    <div className="review-body">
      {paragraphs(r.body).map((p, i) => (
        <p key={i}>{p}</p>
      ))}
    </div>
  ) : (
    <p className="hint">No written review yet. <Link href={`/studio/${m.id}`}>Write one</Link>.</p>
  );

  return (
    <Shell active={cat}>
      <Link className="crumb" href={`/watch/${cat}`}>← {CATEGORY_LABEL[cat]}</Link>
      <article className="stack">
        <div className="detail-hero">
          <Poster url={m.posterUrl} title={m.title} contain priority />
          <div className="detail-head">
            <div className="title-block">
              <h1>{m.title}</h1>
              <div className="detail-sub">
                {m.year && <span>{m.year}</span>}
                {m.originalTitle && <span lang="">{m.originalTitle}</span>}
                {m.runtimeMin ? <span>{m.runtimeMin} min{m.type !== "movie" ? " per episode" : ""}</span> : null}
                <StatusPill status={r.status} />
                {r.featured && <span>Featured</span>}
              </div>
              <div className="my-rating" aria-label="My rating">
                {r.rating != null ? <Stars value={r.rating} size={28} /> : <span className="hint">Not rated yet</span>}
                {r.ratingLabel && <span className="label-text">{r.ratingLabel}</span>}
              </div>
            </div>
            <div className="review-card">
              {r.spoiler && r.body.trim() ? <SpoilerReveal>{body}</SpoilerReveal> : body}
              {m.genreFilters.length > 0 && (
                <div className="watched-with">
                  <span className="label">Genres</span>
                  {m.genreFilters.map((g) => (
                    <Link key={g.id} className="chip" href={`/watch/${cat}?genre=${g.id}`}>{g.name}</Link>
                  ))}
                </div>
              )}
              {m.people.length > 0 && (
                <div className="watched-with">
                  <span className="label">Watched with</span>
                  {m.people.map((p) => (
                    <Link key={p.id} className="chip" href={`/watch/${cat}?with=${p.id}`}>{p.name}</Link>
                  ))}
                </div>
              )}
              {(r.watchedOn || r.watchedIn || m.tags.length > 0) && (
                <div className="detail-sub">
                  {r.watchedOn && <span>Watched {formatDate(r.watchedOn)}</span>}
                  {r.watchedIn && <span className={`where-badge ${r.watchedIn}`}>{r.watchedIn === "theater" ? "🎬 In a theater" : "📺 Streaming"}</span>}
                  {m.tags.length > 0 && (
                    <span className="chips">
                      {m.tags.map((t) => (
                        <Link key={t} className="chip" href={`/watch/${cat}?tag=${encodeURIComponent(t)}`}>{t}</Link>
                      ))}
                    </span>
                  )}
                </div>
              )}
              <div className="toolbar">
                <Link className="btn primary" href={`/studio/${m.id}`}>Edit</Link>
                <ShareDialog
                  data={{ title: m.title, year: m.year, type: m.type, posterUrl: m.posterUrl, rating: r.rating, ratingLabel: r.ratingLabel, status: r.status, body: r.body, spoiler: r.spoiler }}
                />
                <CopyLink />
                <span className="private-note push-left">Only you can open this page</span>
              </div>
            </div>
          </div>
        </div>

        {m.type !== "movie" && (
          <EpisodesSection mediaId={m.id} type={m.type} version={m.version} initial={m.segments} initialSegment={Number((await searchParams).segment) || null} />
        )}

        {(m.overview || about.length > 0) && (
          <section className="panel meta-panel" aria-labelledby="meta-h">
            <h2 id="meta-h">About this {m.type === "movie" ? "film" : "series"}</h2>
            {m.overview && <p>{m.overview}</p>}
            <dl>
              {about.map(([k, v]) => (
                <Fragment key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </Fragment>
              ))}
            </dl>
          </section>
        )}
      </article>
    </Shell>
  );
}
