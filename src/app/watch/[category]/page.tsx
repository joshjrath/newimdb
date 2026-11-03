import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOwnerPage } from "@/lib/guard";
import { Shell } from "@/components/Shell";
import { LibraryCard } from "@/components/LibraryCard";
import { NowStrip } from "@/components/NowStrip";
import { AutoSubmit } from "@/components/AutoSubmit";
import { pageCount, Pager } from "@/components/Pager";
import { countMedia, listMedia, listWatching } from "@/lib/repo/media";
import { SORT_OPTIONS } from "@/lib/domain/sort";
import { allTags } from "@/lib/repo/tags";
import { getDb } from "@/lib/db";
import { parseListQuery } from "@/lib/listQuery";
import { plural } from "@/lib/domain/text";
import { CATEGORY_LABEL, CATEGORY_TO_TYPE, STATUS_LABEL, WATCH_STATUSES, type Category, type WatchStatus } from "@/lib/domain/types";

type SP = Record<string, string | undefined>;
const CATEGORIES = Object.keys(CATEGORY_TO_TYPE) as Category[];
const MOVIE_STATUSES: WatchStatus[] = ["completed", "plan"];

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
  const query = { ...parseListQuery(sp, { pageSize: 24 }), type };
  const { status, tag, q, featured, sort, page = 1 } = query;
  const { items, total, pageSize } = listMedia(query);
  const counts = countMedia();
  const tags = allTags(getDb(), type);
  const filtered = Boolean(status || tag || q || featured);
  const watching = type === "movie" || filtered || page > 1 ? [] : listWatching(type);
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

      <NowStrip items={watching} />

      <div className="filters stack tight">
        <form className="toolbar" method="get" action={`/watch/${cat}`} role="search">
          {status && <input type="hidden" name="status" value={status} />}
          {tag && <input type="hidden" name="tag" value={tag} />}
          {featured && <input type="hidden" name="featured" value="1" />}
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
            <LibraryCard key={m.id} m={m} />
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
