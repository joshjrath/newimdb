import { ownerApi } from "@/lib/guard";
import { animeCandidates, animeCheckState, runAnimeCheck } from "@/lib/anime/job";

const status = () => ({ check: animeCheckState(), unchecked: animeCandidates().length });

/** Where the automatic anime sorting is up to, and what it moved last time. */
export const GET = ownerApi(async () => status());

/** Check every unchecked animated title now (in the background). */
export const POST = ownerApi(async () => {
  void runAnimeCheck().catch((e) => console.error("[anime] check failed:", e));
  await new Promise((r) => setTimeout(r, 50));
  return status();
});
