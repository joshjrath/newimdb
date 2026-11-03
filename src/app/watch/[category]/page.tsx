import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOwnerPage } from "@/lib/guard";
import { Shell } from "@/components/Shell";
import { LibraryCard } from "@/components/LibraryCard";
import { NowStrip } from "@/components/NowStrip";
import { AutoSubmit } from "@/components/AutoSubmit";
import { countMedia, listMedia, listWatching, type SortKey } from "@/lib/repo/media";
import { allTags } from "@/lib/repo/tags";
import { getDb } from "@/lib/db";
import { CATEGORY_LABEL, CATEGORY_TO_TYPE, STATUS_LABEL, WATCH_STATUSES, type Category, type WatchStatus } from "@/lib/domain/types";

export const dynamic = "force-dynamic";

type SP = { status?: string; tag?: string; q?: string; sort?: string; page?: string; featured?: string };

export async function generateMetadata({ params }: { params: Promise<{ category: string }> }) {
  const { category } = await params;
  return { title: CATEGORY_LABEL[category as Category] ?? "Library" };
}

const SORTS: { key: SortKey; label: string }[] = [
  { key: "recent", label: "Recently watched" },
  { key: "rating", label: "Highest rated" },
  { key: "title", label: "Title" },
  { key: "year", label: "Release year" },
  { key: "added", label: "Recently added" },
];

export default async function LibraryPage({ params, searchParams }: { params: Promise<{ category: string }>; searchParams: Promise<SP> }) {
  const { category } = await params;
  await requireOwnerPage(`/watch/${category}`);
  if (!(category in CATEGORY_TO_TYPE)) notFound();
  const cat = category as Category;
  const type = CATEGORY_TO_TYPE[cat];
  const sp = await searchParams;
  const status = WATCH_STATUSES.includes(sp.status as WatchStatus) ? (sp.status as WatchStatus) : undefined;
  const sort = (SORTS.find((s) => s.key === sp.sort)?.key ?? "recent") as SortKey;
  const page = Math.max(1, Number(sp.page) || 1);
  const featured = sp.featured === "1";
  const { items, total, pageSize } = listMedia({ type, status, tag: sp.tag, q: sp.q, sort, page, pageSize: 24, featured });
  const counts = countMedia();
  const tags = allTags(getDb(), type);
  const watching = type === "movie" || status || sp.tag || sp.q || page > 1 ? [] : listWatching(type);
  const pages = Math.max(1, Math.ceil(total / pageSize));

  const href = (patch: Partial<SP>) => {
    const next = { ...sp, page: undefined, ...patch };
    const qs = new URLSearchParams(Object.entries(next).filter(([, v]) => v) as [string, string][]).toString();
    return `/watch/${cat}${qs ? `?${qs}` : ""}`;
  };
  const filtered = Boolean(status || sp.tag || sp.q || featured);

  return (
    <Shell active="watch">
      <nav className="cat-tabs" aria-label="Category">
        {(Object.keys(CATEGORY_TO_TYPE) as Category[]).map((c) => (
          <Link key={c} href={`/watch/${c}`} aria-current={c === cat ? "page" : undefined}>
            {CATEGORY_LABEL[c]}
            <span className="count">{counts[CATEGORY_TO_TYPE[c]]}</span>
          </Link>
        ))}
      </nav>

      <NowStrip items={watching} />

      <form className="toolbar" method="get" action={`/watch/${cat}`} role="search" style={{ marginBottom: 14 }}>
        {status && <input type="hidden" name="status" value={status} />}
        {sp.tag && <input type="hidden" name="tag" value={sp.tag} />}
        {featured && <input type="hidden" name="featured" value="1" />}
        <label className="grow">
          <span className="visually-hidden">Search {CATEGORY_LABEL[cat]}</span>
          <input className="input" type="search" name="q" defaultValue={sp.q} placeholder={`Search ${CATEGORY_LABEL[cat].toLowerCase()} and reviews`} />
        </label>
        <label>
          <span className="visually-hidden">Sort</span>
          <AutoSubmit>
            <select className="select" name="sort" defaultValue={sort}>
              {SORTS.map((s) => (
                <option key={s.key} value={s.key}>{s.label}</option>
              ))}
            </select>
          </AutoSubmit>
        </label>
        <button className="btn" type="submit">Search</button>
      </form>

      <div className="chips" style={{ marginBottom: 10 }} aria-label="Filter by status">
        <Link className="chip" href={href({ status: undefined })} aria-current={!status ? "true" : undefined}>All</Link>
        {(type === "movie" ? (["completed", "plan"] as WatchStatus[]) : WATCH_STATUSES).map((s) => (
          <Link key={s} className="chip" href={href({ status: s === status ? undefined : s })} aria-current={s === status ? "true" : undefined}>
            {s === "watching" ? "Currently watching" : STATUS_LABEL[s]}
          </Link>
        ))}
        <Link className="chip" href={href({ featured: featured ? undefined : "1" })} aria-current={featured ? "true" : undefined}>Featured</Link>
      </div>
      {tags.length > 0 && (
        <div className="chips" style={{ marginBottom: 28 }} aria-label="Filter by tag">
          {tags.map((t) => (
            <Link key={t.name} className="chip" href={href({ tag: sp.tag?.toLowerCase() === t.name.toLowerCase() ? undefined : t.name })} aria-current={sp.tag?.toLowerCase() === t.name.toLowerCase() ? "true" : undefined}>
              {t.name}
            </Link>
          ))}
        </div>
      )}

      <p className="hint" style={{ marginBottom: 18 }}>
        {total} {total === 1 ? "entry" : "entries"}
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
          <h2>{filtered ? "Nothing matches these filters" : `No ${CATEGORY_LABEL[cat].toLowerCase()} yet`}</h2>
          <p>{filtered ? "Try another filter, or clear them." : "Add your first one in Studio, or import from Letterboxd."}</p>
          <Link className="btn primary" href={`/studio/new?type=${type}`}>Add {type === "movie" ? "a movie" : type === "tv" ? "a show" : "an anime"}</Link>
        </div>
      )}

      {pages > 1 && (
        <nav className="pager" aria-label="Pages">
          {page > 1 && <Link className="btn small" href={href({ page: String(page - 1) })}>Previous</Link>}
          <span>Page {page} of {pages}</span>
          {page < pages && <Link className="btn small" href={href({ page: String(page + 1) })}>Next</Link>}
        </nav>
      )}
    </Shell>
  );
}
