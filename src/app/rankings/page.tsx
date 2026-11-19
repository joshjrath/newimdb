import { Suspense } from "react";
import { requireOwnerPage } from "@/lib/guard";
import { Shell } from "@/components/Shell";
import { RankingsBoard } from "@/components/rankings/RankingsBoard";
import { getRankings } from "@/lib/repo/rankings";
import { MEDIA_TYPES, type MediaType } from "@/lib/domain/types";

export const metadata = { title: "Rankings" };

export default async function RankingsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireOwnerPage("/rankings");
  const sp = await searchParams;
  const kind = (MEDIA_TYPES as readonly string[]).includes(sp.kind ?? "") ? (sp.kind as MediaType) : "movie";
  const mode = sp.mode === "tiers" ? "tiers" : "top";
  return (
    <Shell active="rankings">
      <header className="page-head">
        <div>
          <h1>Rankings</h1>
          <p className="sub">Your all-time order, and your tier list.</p>
        </div>
      </header>
      <Suspense fallback={null}>
        <RankingsBoard key={kind} initial={getRankings(kind)} mode={mode} />
      </Suspense>
    </Shell>
  );
}
