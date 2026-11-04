import { requireOwnerPage } from "@/lib/guard";
import { Shell } from "@/components/Shell";
import { RecommendBoard } from "@/components/recommend/RecommendBoard";
import { listRecommendations, recommendState, startRecommendationsIfStale } from "@/lib/recommend/job";
import { tmdbConfigured } from "@/lib/providers/tmdb";
import { getDb } from "@/lib/db";

export const metadata = { title: "Recommended" };

export default async function RecommendedPage() {
  await requireOwnerPage("/recommended");
  startRecommendationsIfStale();
  const rated = (getDb().prepare(`SELECT COUNT(*) n FROM review WHERE rating IS NOT NULL`).get() as { n: number }).n;
  return (
    <Shell active="recommended">
      <header className="page-head">
        <div>
          <h1>Recommended</h1>
          <p className="sub">What you&apos;d enjoy most next, and where to watch it.</p>
        </div>
      </header>
      <RecommendBoard initial={{ ...listRecommendations(), state: recommendState(), tmdb: tmdbConfigured() }} rated={rated} />
    </Shell>
  );
}
