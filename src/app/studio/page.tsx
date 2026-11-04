import Link from "next/link";
import { requireOwnerPage } from "@/lib/guard";
import { Shell } from "@/components/Shell";
import { ManageTable } from "@/components/studio/ManageTable";
import { countMedia, listMedia } from "@/lib/repo/media";
import { parseListQuery } from "@/lib/listQuery";
import { plural } from "@/lib/domain/text";
import { listPeople } from "@/lib/repo/people";

export const metadata = { title: "Studio" };

export default async function StudioPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireOwnerPage("/studio");
  const query = parseListQuery(await searchParams, { sort: "added", pageSize: 50 });
  const data = listMedia(query);
  const counts = countMedia();
  const people = listPeople();
  const withName = query.withPerson ? people.find((p) => p.id === query.withPerson)?.name : undefined;
  return (
    <Shell active="studio">
      <div className="page-head">
        <div>
          <h1>Studio</h1>
          <p className="hint">
            {withName
              ? `${plural(data.total, "title", "titles")} watched with ${withName}.`
              : `${plural(counts.total, "entry", "entries")}: ${counts.movie} movies, ${counts.tv} TV shows, ${counts.anime} anime.`}
          </p>
        </div>
        <Link className="btn primary" href={`/studio/new${query.type ? `?type=${query.type}` : ""}`}>Add title</Link>
      </div>
      <ManageTable
        items={data.items.map((m) => ({
          id: m.id,
          title: m.title,
          year: m.year,
          type: m.type,
          rating: m.review.rating,
          status: m.review.status,
          featured: m.review.featured,
          updatedAt: m.updatedAt,
          source: m.review.source,
          tags: m.tags,
          people: m.people.map((p) => p.name),
          progress: m.progress ? `${m.progress.watched}/${m.progress.denominator}` : null,
        }))}
        total={data.total}
        page={data.page}
        pageSize={data.pageSize}
        filters={{ type: query.type ?? "", status: query.status ?? "", q: query.q ?? "", sort: query.sort ?? "added", with: query.withPerson ? String(query.withPerson) : "" }}
        people={people.map(({ id, name }) => ({ id, name }))}
      />
    </Shell>
  );
}
