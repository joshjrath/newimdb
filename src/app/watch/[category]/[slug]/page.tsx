import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { isOwner, requireOwnerPage } from "@/lib/guard";
import { Shell } from "@/components/Shell";
import { Poster } from "@/components/Poster";
import { Stars } from "@/components/Stars";
import { StatusPill } from "@/components/StatusPill";
import { Heatmap } from "@/components/Heatmap";
import { ShareDialog } from "@/components/ShareDialog";
import { SpoilerReveal, CopyLink } from "@/components/DetailClient";
import { mediaHref } from "@/components/LibraryCard";
import { getMediaDetail } from "@/lib/repo/media";
import { idFromSlug, paragraphs } from "@/lib/domain/text";
import { CATEGORY_LABEL, TYPE_TO_CATEGORY, type Category } from "@/lib/domain/types";
import { formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  if (!(await isOwner())) return { title: "Sign in" };
  const id = idFromSlug((await params).slug);
  const m = id ? getMediaDetail(id) : null;
  return { title: m?.title ?? "Not found" };
}

export default async function DetailPage({ params, searchParams }: { params: Promise<{ category: string; slug: string }>; searchParams: Promise<{ segment?: string }> }) {
  const { category, slug } = await params;
  await requireOwnerPage(`/watch/${category}/${slug}`);
  const id = idFromSlug(slug);
  const m = id ? getMediaDetail(id) : null;
  if (!m) notFound();
  const canonical = mediaHref(m);
  if (canonical !== `/watch/${category}/${slug}`) redirect(canonical);
  const r = m.review;
  const sp = await searchParams;
  const cat = TYPE_TO_CATEGORY[m.type] as Category;

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
    <Shell active="watch">
      <p className="hint" style={{ marginTop: 8 }}>
        <Link href={`/watch/${cat}`}>{CATEGORY_LABEL[cat]}</Link>
      </p>
      <article>
        <div className="detail-hero">
          <Poster url={m.posterUrl} title={m.title} contain priority />
          <div className="detail-head">
            <h1>{m.title}</h1>
            <div className="detail-sub">
              {m.year && <span>{m.year}</span>}
              {m.originalTitle && <span lang="">{m.originalTitle}</span>}
              {m.runtimeMin ? <span>{m.runtimeMin} min{m.type !== "movie" ? " per episode" : ""}</span> : null}
              <StatusPill status={r.status} />
              {r.featured && <span className="hint">Featured</span>}
            </div>
            <div className="my-rating" aria-label="My rating">
              {r.rating != null ? <Stars value={r.rating} size={26} /> : <span className="hint">Not rated yet</span>}
              {r.ratingLabel && <span className="label-text">{r.ratingLabel}</span>}
            </div>
            {r.spoiler && r.body.trim() ? <SpoilerReveal>{body}</SpoilerReveal> : body}
            <div className="detail-sub">
              {r.watchedOn && <span>Watched {formatDate(r.watchedOn)}</span>}
              {m.tags.length > 0 && (
                <span className="chips">
                  {m.tags.map((t) => (
                    <Link key={t} className="chip" href={`/watch/${cat}?tag=${encodeURIComponent(t)}`}>{t}</Link>
                  ))}
                </span>
              )}
            </div>
            <div className="toolbar">
              <Link className="btn primary" href={`/studio/${m.id}`}>Edit</Link>
              <ShareDialog
                data={{ title: m.title, year: m.year, type: m.type, posterUrl: m.posterUrl, rating: r.rating, ratingLabel: r.ratingLabel, status: r.status, body: r.body, spoiler: r.spoiler }}
              />
              <CopyLink />
            </div>
            <p className="private-note">Private. Only you can open this page.</p>
          </div>
        </div>

        {m.type !== "movie" && (
          <section className="section" aria-labelledby="eps-h">
            <header>
              <h2 id="eps-h">Episodes</h2>
              <Link className="btn small ghost" href={`/studio/${m.id}#structure`}>Edit seasons</Link>
            </header>
            <p className="hint">
              Your overall rating above is set by you. The episode average below is calculated and shown separately.
            </p>
            <Heatmap mediaId={m.id} initial={m.segments} initialSegment={Number(sp.segment) || null} />
          </section>
        )}

        {(m.overview || m.genres.length > 0 || m.thirdPartyRating != null || m.imdbId || m.tmdbId || m.malId || m.tvmazeId || r.source === "letterboxd") && (
        <section className="section meta-panel" aria-labelledby="meta-h">
          <h2 id="meta-h" style={{ fontSize: "1.05rem" }}>About this {m.type === "movie" ? "film" : "series"}</h2>
          {m.overview && <p style={{ maxWidth: "68ch" }}>{m.overview}</p>}
          <dl>
            {m.genres.length > 0 && (<><dt>Genres</dt><dd>{m.genres.join(", ")}</dd></>)}
            {m.thirdPartyRating != null && (<><dt>{m.thirdPartyRatingSource ?? "Public"} score</dt><dd>{m.thirdPartyRating.toFixed(1)} / 10 (not my rating)</dd></>)}
            {m.imdbId && (<><dt>IMDb</dt><dd>{m.imdbId}</dd></>)}
            {m.tmdbId && (<><dt>TMDB</dt><dd>{m.tmdbId}</dd></>)}
            {m.malId && (<><dt>MyAnimeList</dt><dd>{m.malId}</dd></>)}
            {m.tvmazeId && (<><dt>TVmaze</dt><dd>{m.tvmazeId}</dd></>)}
            {r.source === "letterboxd" && (<><dt>Source</dt><dd>Imported from Letterboxd</dd></>)}
            {m.metadataSource && m.metadataSource !== "letterboxd" && (<><dt>Details from</dt><dd>{m.metadataSource}</dd></>)}
          </dl>
        </section>
        )}
      </article>
    </Shell>
  );
}
