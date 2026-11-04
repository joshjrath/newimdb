import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getSharedList } from "@/lib/repo/lists";
import { formatDate } from "@/lib/format";
import { TYPE_LABEL } from "@/lib/domain/types";
import { plural } from "@/lib/domain/text";

export const dynamic = "force-dynamic";

type P = { params: Promise<{ token: string }> };

export async function generateMetadata({ params }: P) {
  const list = getSharedList((await params).token);
  if (!list) return { title: "List not found", robots: { index: false, follow: false } };
  const description = list.description || `${plural(list.count, "title", "titles")} · movies, shows and anime`;
  // Link previews need absolute addresses for the card image.
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return {
    metadataBase: new URL(`${proto}://${host}`),
    title: list.name,
    description,
    robots: { index: false, follow: false },
    openGraph: { title: list.name, description, type: "website" },
    twitter: { card: "summary_large_image", title: list.name, description },
  };
}

/** A list someone shared with you: read-only, just the list. */
export default async function SharedListPage({ params }: P) {
  const { token } = await params;
  const list = getSharedList(token);
  if (!list) notFound();
  const poster = (src: string | null) => (src ? `/api/share/${token}/poster?src=${encodeURIComponent(src)}` : null);
  const mix = (["movie", "tv", "anime"] as const).map((t) => [t, list.items.filter((i) => i.type === t).length] as const).filter(([, n]) => n > 0);
  const hero = list.items.filter((i) => i.posterUrl).slice(0, 5);
  return (
    <main className="share-page">
      <header className="share-hero">
        <div className="share-collage" aria-hidden="true">
          {hero.map((i, k) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={k} src={poster(i.posterUrl)!} alt="" style={{ ["--k" as string]: k }} />
          ))}
        </div>
        <div className="share-head">
          <span className="share-kicker">A list</span>
          <h1>{list.name}</h1>
          {list.description && <p className="share-desc">{list.description}</p>}
          <p className="share-meta">
            {plural(list.count, "title", "titles")}
            {mix.map(([t, n]) => (
              <span key={t} className={`share-chip t-${t}`}>{n} {TYPE_LABEL[t]}{n === 1 ? "" : t === "anime" ? "" : "s"}</span>
            ))}
          </p>
          <div className="share-progress" aria-label={`${list.finished} of ${list.count} watched`}>
            <span style={{ width: `${list.percent}%` }} />
          </div>
          <span className="share-progress-label">{list.finished} of {list.count} watched by the person who made it</span>
        </div>
      </header>

      <ol className="share-grid">
        {list.items.map((i) => (
          <li key={i.n} className={i.watched ? "seen" : ""}>
            <div className="share-poster">
              {i.posterUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={poster(i.posterUrl)!} alt={`Poster for ${i.title}`} loading="lazy" />
              ) : (
                <span className="share-fallback">{i.title}</span>
              )}
              <span className="share-n">{i.n}</span>
              {i.watched && <span className="share-seen" title="Watched">✓</span>}
            </div>
            <h2>{i.title}</h2>
            <p>
              <span className={`share-dot t-${i.type}`} /> {TYPE_LABEL[i.type]}
              {i.releaseDate ? ` · ${formatDate(i.releaseDate)}` : i.year ? ` · ${i.year}` : ""}
              {i.rating != null && <span className="share-rating"> · ★ {i.rating}</span>}
            </p>
          </li>
        ))}
      </ol>
      <footer className="share-foot">Shared from a private Specular Watch library</footer>
    </main>
  );
}
