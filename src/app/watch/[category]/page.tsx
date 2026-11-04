import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOwnerPage } from "@/lib/guard";
import { Shell } from "@/components/Shell";
import { LibraryCard } from "@/components/LibraryCard";
import { NowStrip } from "@/components/NowStrip";
import { ReturningStrip } from "@/components/ReturningStrip";
import { AiringStrip, UpcomingStrip } from "@/components/AiringStrips";
import { AutoSubmit } from "@/components/AutoSubmit";
import { pageCount, Pager } from "@/components/Pager";
import { countMedia, listMedia, listShowSections, listWatching } from "@/lib/repo/media";
import { SORT_OPTIONS } from "@/lib/domain/sort";
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
  const { status, tag, q, featured, sort, page = 1, withPerson, genre } = query;
  const { items, total, pageSize } = listMedia(query);
  const counts = countMedia();
  const tags = allTags(getDb(), type);
  const people = listPeople(getDb(), type).filter((p) => p.count > 0);
  const genres = listGenres(getDb(), type).filter((g) => g.count > 0 || g.id === genre);
  const filtered = Boolean(status || tag || q || featured || withPerson || genre);
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
          <ReturningStrip items={sections.returning} />
          <NowStrip items={watching} />
          <UpcomingStrip items={sections.upcoming} />
        </>
      )}

      <div className="filters stack tight">
        <form className="toolbar" method="get" action={`/watch/${cat}`} role="search">
          {status && <input type="hidden" name="status" value={status} />}
          {tag && <input type="hidden" name="tag" value={tag} />}
          {featured && <input type="hidden" name="featured" value="1" />}
          {withPerson && <input type="hidden" name="with" value={withPerson} />}
          <label className="grow">
            <span className="visually-hidden">Search {label}</span>
            <input className="input" type="search" name="q" defaultValue={q} placeholder={`Search ${label.toLowerCase()} and reviews`} />
          </label>
          <label>
            <span className="visually-hidden">Sort</span>
            <AutoSubmit>
              <select className="select" name="sort" defaultValue={sort}>
                {SORT_OPTIONS.map((s) => (
                  <option key={s.key} value={s.key}>{s.label}</option>
                ))}
              </select>
            </AutoSubmit>
          </label>
          <button className="btn" type="submit">Search</button>
        </form>

        <div className="chips" aria-label="Filter by status">
          <Link className="chip" href={href({ status: undefined })} aria-current={!status ? "true" : undefined}>All</Link>
          {(type === "movie" ? MOVIE_STATUSES : WATCH_STATUSES).map((s) => (
            <Link key={s} className="chip" href={href({ status: s === status ? undefined : s })} aria-current={s === status ? "true" : undefined}>
              {s === "watching" ? "Currently watching" : STATUS_LABEL[s]}
            </Link>
          ))}
          <Link className="chip" href={href({ featured: featured ? undefined : "1" })} aria-current={featured ? "true" : undefined}>Featured</Link>
        </div>
        {genres.length > 0 && (
          <div className="chips with-chips" aria-label="Filter by genre">
            <span className="label" style={{ alignSelf: "center", marginRight: 2 }}>Genre</span>
            {genres.map((g) => (
              <Link key={g.id} className="chip" href={href({ genre: genre === g.id ? undefined : String(g.id) })} aria-current={genre === g.id ? "true" : undefined}>
                {g.name} <span className="hint">{g.count}</span>
              </Link>
            ))}
          </div>
        )}
        {people.length > 0 && (
          <div className="chips with-chips" aria-label="Filter by who you watched with">
            <span className="label" style={{ alignSelf: "center", marginRight: 2 }}>Watched with</span>
            {people.map((p) => (
              <Link key={p.id} className="chip" href={href({ with: withPerson === p.id ? undefined : String(p.id) })} aria-current={withPerson === p.id ? "true" : undefined}>
                {p.name} <span className="hint">{p.count}</span>
              </Link>
            ))}
          </div>
        )}
        {tags.length > 0 && (
          <div className="chips" aria-label="Filter by tag">
            {tags.map((t) => (
              <Link key={t.name} className="chip" href={href({ tag: sameTag(t.name) ? undefined : t.name })} aria-current={sameTag(t.name) ? "true" : undefined}>
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
        <div className="library">
          {items.map((m) => (
            <LibraryCard key={m.id} m={m} returning={returningById.get(m.id)} />
          ))}
        </div>
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
