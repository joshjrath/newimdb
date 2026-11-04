import { ownerApi } from "@/lib/guard";
import { listRecommendations, recommendState, runRecommendations } from "@/lib/recommend/job";
import { tmdbConfigured } from "@/lib/providers/tmdb";

const status = () => ({ ...listRecommendations(), state: recommendState(), tmdb: tmdbConfigured() });

export const GET = ownerApi(async () => status());

/** Rebuild your recommendations now (in the background). */
export const POST = ownerApi(async () => {
  void runRecommendations();
  await new Promise((r) => setTimeout(r, 50));
  return status();
});
