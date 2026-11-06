import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOwnerPage } from "@/lib/guard";
import { Shell } from "@/components/Shell";
import { LibraryCard } from "@/components/LibraryCard";
import { SortMenu } from "@/components/SortMenu";
import { LiveSearch } from "@/components/LiveSearch";
import { Suspense } from "react";
import { SelectableGrid } from "@/components/SelectableGrid";
import { listLists } from "@/lib/repo/lists";
import { NowStrip } from "@/components/NowStrip";
import { ReturningStrip } from "@/components/ReturningStrip";
import { AiringStrip, UpcomingStrip } from "@/components/AiringStrips";
import { pageCount, Pager } from "@/components/Pager";
import { countMedia, listMedia, listShowSections, listWatching } from "@/lib/repo/media";
import { allTags } from "@/lib/repo/tags";
import { listPeople } from "@/lib/repo/people";
import { listGenres } from "@/lib/repo/genres";
import { getDb } from "@/lib/db";
import { parseListQuery } from "@/lib/listQuery";
import { plural } from "@/lib/domain/text";
import { CATEGORY_LABEL, CATEGORY_TO_TYPE, STATUS_LABEL, WATCH_STATUSES, type Category, type WatchStatus } from "@/lib/domain/types";

type SP = Record<string, string | undefined>;
const CATEGORIES = Object.keys(CATEGORY_TO_TYPE) as Category[];
const MOVIE_STATUSES: WatchStatus[] = ["completed", "plan"];
/** 60 divides evenly into 1, 2, 3, 4, 5 and 6 columns, so every full page ends on a full row. */
const LIBRARY_PAGE_SIZE = 60;

export async function generateMetadata({ params }: { params: Promise<{ category: string }> }) {
  return { title: CATEGORY_LABEL[(await params).category as Category] ?? "Library" };
}

export default async function LibraryPage({ params, searchParams }: { params: Promise<{ category: string }>; searchParams: Promise<SP> }) {
  const { category } = await params;
  await requireOwnerPage(`/watch/${category}`);
  if (!CATEGORIES.includes(category as Category)) notFound();
  const cat = category as Category;
  const type = CATEGORY_TO_TYPE[cat];
  const sp = await searchParams;
  const query = { ...parseListQuery(sp, { pageSize: LIBRARY_PAGE_SIZE }), type };
  const { status, statuses, tag, q, featured, sort, page = 1, withPeople = [], alone, genre, watchedIn } = query;
  // Status chips: tap several to see any of them.
  const picked: string[] = statuses ?? (status && status !== "none" ? [status] : []);
  const toggleStatus = (s: string) => (picked.includes(s) ? picked.filter((x) => x !== s) : [...picked, s]).join(",") || undefined;
  const { items, total, pageSize } = listMedia(query);
  const counts = countMedia();
  const tags = allTags(getDb(), type);
  const people = listPeople(getDb(), type).filter((p) => p.count > 0);
  // "Alone": watched with nobody marked (Plan to watch doesn't count).
  const aloneCount = (getDb()
    .prepare(`SELECT COUNT(*) n FROM media m LEFT JOIN review r ON r.media_id = m.id WHERE m.type = ? AND COALESCE(r.status, '') != 'plan' AND NOT EXISTS (SELECT 1 FROM media_person mp WHERE mp.media_id = m.id)`)
    .get(type) as { n: number }).n;
  const genres = listGenres(getDb(), type).filter((g) => g.count > 0 || g.id === genre);
  const filtered = Boolean(picked.length || tag || q || featured || withPeople.length || alone || genre || watchedIn);
  const watching = type === "movie" || filtered || page > 1 ? [] : listWatching(type);
  // Shows you'd finished that have a new season: a strip up top, and a badge on their cards.
  const sections = type === "movie" ? { airing: [], upcoming: [], returning: [] } : listShowSections(type);
  const returningById = new Map(sections.returning.map((m) => [m.id, m.returning]));
  const label = CATEGORY_LABEL[cat];

  const href = (patch: SP) => {
    const next: SP = { ...sp, page: undefined, ...patch };
    const qs = new URLSearchParams(Object.entries(next).filter((e): e is [string, string] => Boolean(e[1]))).toString();
    return `/watch/${cat}${qs ? `?${qs}` : ""}`;
  };
  const sameTag = (t: string) => tag?.toLowerCase() === t.toLowerCase();

  return (
    <Shell active={cat}>
      <header className="page-head">
        <div>
          <h1>{label}</h1>
          <p className="sub">{plural(counts[type], "entry", "entries")} · private</p>
        </div>
        <nav className="seg" aria-label="Category">
          {CATEGORIES.map((c) => (
            <Link key={c} className={`cat-${c}`} href={`/watch/${c}`} aria-current={c === cat ? "page" : undefined}>
              {CATEGORY_LABEL[c]}
              <span className="n">{counts[CATEGORY_TO_TYPE[c]]}</span>
            </Link>
          ))}
        </nav>
      </header>

      {!filtered && page === 1 && (
        <>
          <AiringStrip items={sections.airing} />
          {/* A show already in Currently watching doesn't need to be here too. */}
          <ReturningStrip items={sections.returning.filter((m) => !watching.some((w) => w.id === m.id))} />
          <NowStrip items={watching} />
          <UpcomingStrip items={sections.upcoming} />
        </>
      )}

      <div className="filters stack tight">
        <form className="toolbar" method="get" action={`/watch/${cat}`} role="search">
          {picked.length > 0 && <input type="hidden" name="status" value={picked.join(",")} />}
          {tag && <input type="hidden" name="tag" value={tag} />}
          {featured && <input type="hidden" name="featured" value="1" />}
          {(withPeople.length > 0 || alone) && <input type="hidden" name="with" value={alone ? "alone" : withPeople.join(",")} />}
          <label className="grow">
            <span className="visually-hidden">Search {label}</span>
            <Suspense fallback={<input className="input" type="search" name="q" defaultValue={q} placeholder={`Search ${label.toLowerCase()} and reviews`} />}>
              <LiveSearch placeholder={`Search ${label.toLowerCase()} and reviews`} label={`Search ${label}`} />
            </Suspense>
          </label>
          {genre && <input type="hidden" name="genre" value={genre} />}
          {watchedIn && <input type="hidden" name="where" value={watchedIn} />}
          {sort && <input type="hidden" name="sort" value={sort} />}
          {query.dir && <input type="hidden" name="dir" value={query.dir} />}
          <button className="btn" type="submit">Search</button>
          <Suspense fallback={null}>
            <SortMenu sort={sort ?? "recent"} dir={query.dir} exclude={type === "movie" ? ["progress"] : []} />
          </Suspense>
        </form>

        <div className="chips" aria-label="Filter by status">
          <Link className="chip" scroll={false} href={href({ status: undefined })} aria-current={!picked.length ? "true" : undefined}>All</Link>
          {(type === "movie" ? MOVIE_STATUSES : WATCH_STATUSES).map((s) => (
            <Link key={s} className="chip" scroll={false} href={href({ status: toggleStatus(s) })} aria-current={picked.includes(s) ? "true" : undefined}>
              {s === "watching" ? "Currently watching" : STATUS_LABEL[s]}
            </Link>
          ))}
          <Link className="chip" scroll={false} href={href({ featured: featured ? undefined : "1" })} aria-current={featured ? "true" : undefined}>Featured</Link>
          {type === "movie" &&
            (["theater", "streaming"] as const).map((w) => (
              <Link key={w} className="chip" scroll={false} href={href({ where: watchedIn === w ? undefined : w })} aria-current={watchedIn === w ? "true" : undefined}>
                {w === "theater" ? "🎬 In theaters" : "📺 Streaming"}
              </Link>
            ))}
        </div>
        {genres.length > 0 && (
          <div className="chips with-chips" aria-label="Filter by genre">
            <span className="label" style={{ alignSelf: "center", marginRight: 2 }}>Genre</span>
            {genres.map((g) => (
              <Link key={g.id} className="chip" scroll={false} href={href({ genre: genre === g.id ? undefined : String(g.id) })} aria-current={genre === g.id ? "true" : undefined}>
                {g.name} <span className="hint">{g.count}</span>
              </Link>
            ))}
          </div>
        )}
        {(people.length > 0 || aloneCount > 0) && (
          <div className="chips with-chips" aria-label="Filter by who you watched with">
            <span className="label" style={{ alignSelf: "center", marginRight: 2 }}>Watched with</span>
            {aloneCount > 0 && (
              <Link className="chip" scroll={false} href={href({ with: alone ? undefined : "alone" })} aria-current={alone ? "true" : undefined} title="Titles with nobody in Watched with">
                Alone <span className="hint">{aloneCount}</span>
              </Link>
            )}
            {people.map((p) => (
              <Link
                key={p.id}
                className="chip"
                scroll={false}
                // Tap several: only titles you watched with all of them.
                // Picking a person leaves "Alone".
                href={href({ with: (alone ? [p.id] : withPeople.includes(p.id) ? withPeople.filter((x) => x !== p.id) : [...withPeople, p.id]).join(",") || undefined })}
                aria-current={withPeople.includes(p.id) ? "true" : undefined}
              >
                {p.name} <span className="hint">{p.count}</span>
              </Link>
            ))}
          </div>
        )}
        {tags.length > 0 && (
          <div className="chips" aria-label="Filter by tag">
            {tags.map((t) => (
              <Link key={t.name} className="chip" scroll={false} href={href({ tag: sameTag(t.name) ? undefined : t.name })} aria-current={sameTag(t.name) ? "true" : undefined}>
                {t.name}
              </Link>
            ))}
          </div>
        )}
      </div>

      <p className="count-line">
        {filtered ? `${plural(total, "match", "matches")}` : plural(total, "entry", "entries")}
        {filtered && <> · <Link href={`/watch/${cat}`}>Clear filters</Link></>}
      </p>

      {items.length ? (
        <SelectableGrid
          movies={type === "movie"}
          pageIds={items.map((m) => m.id)}
          people={listPeople().map(({ id, name }) => ({ id, name }))}
          genres={listGenres().map(({ id, name }) => ({ id, name }))}
          lists={listLists().map(({ id, name }) => ({ id, name }))}
          statuses={(type === "movie" ? MOVIE_STATUSES : WATCH_STATUSES).map((s) => ({ key: s, label: STATUS_LABEL[s] }))}
        >
          {items.map((m) => (
            <div key={m.id} data-select-id={m.id} className="select-cell">
              <LibraryCard m={m} returning={returningById.get(m.id)} />
            </div>
          ))}
        </SelectableGrid>
      ) : (
        <div className="empty-state">
          <h2>{filtered ? "Nothing matches these filters" : `No ${label.toLowerCase()} yet`}</h2>
          <p>{filtered ? "Try another filter, or clear them." : "Add your first one in Studio, or import from Letterboxd."}</p>
          <Link className="btn primary" href={`/studio/new?type=${type}`}>Add {type === "movie" ? "a movie" : type === "tv" ? "a show" : "an anime"}</Link>
        </div>
      )}

      <Pager page={page} pages={pageCount(total, pageSize)} href={(p) => href({ page: String(p) })} />
    </Shell>
  );
}
