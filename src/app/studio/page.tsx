import Link from "next/link";
import { requireOwnerPage } from "@/lib/guard";
import { Shell } from "@/components/Shell";
import { ManageTable } from "@/components/studio/ManageTable";
import { countMedia, listMedia, type SortKey } from "@/lib/repo/media";
import { MEDIA_TYPES, WATCH_STATUSES, type MediaType, type WatchStatus } from "@/lib/domain/types";

export const dynamic = "force-dynamic";
export const metadata = { title: "Studio" };

export default async function StudioPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireOwnerPage("/studio");
  const sp = await searchParams;
  const type = MEDIA_TYPES.includes(sp.type as MediaType) ? (sp.type as MediaType) : undefined;
  const status = sp.status === "none" ? "none" : WATCH_STATUSES.includes(sp.status as WatchStatus) ? (sp.status as WatchStatus) : undefined;
  const sort = (["recent", "rating", "title", "year", "added"].includes(sp.sort ?? "") ? sp.sort : "added") as SortKey;
  const page = Math.max(1, Number(sp.page) || 1);
  const data = listMedia({ type, status, q: sp.q, sort, page, pageSize: 50 });
  const counts = countMedia();
  return (
    <Shell active="studio">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "end", gap: 16, flexWrap: "wrap", margin: "24px 0" }}>
        <div>
          <h1>Studio</h1>
          <p className="hint">
            {counts.total} {counts.total === 1 ? "entry" : "entries"}: {counts.movie} movies, {counts.tv} TV shows, {counts.anime} anime.
          </p>
        </div>
        <Link className="btn primary" href={`/studio/new${type ? `?type=${type}` : ""}`}>Add title</Link>
      </div>
      <ManageTable
        items={data.items.map((m) => ({
          id: m.id, title: m.title, year: m.year, type: m.type, posterUrl: m.posterUrl, rating: m.review.rating,
          status: m.review.status, featured: m.review.featured, updatedAt: m.updatedAt, source: m.review.source, tags: m.tags,
          progress: m.progress ? `${m.progress.watched}/${m.progress.denominator}` : null,
        }))}
        total={data.total}
        page={data.page}
        pageSize={data.pageSize}
        filters={{ type: type ?? "", status: status ?? "", q: sp.q ?? "", sort }}
      />
    </Shell>
  );
}
