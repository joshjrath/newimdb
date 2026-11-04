import { ownerApi } from "@/lib/guard";
import { startKeywordJob } from "@/lib/genres/keywords";
import { genreState } from "@/lib/genres/state";

/** Fetch TMDB keywords for titles that don't have them yet (background). */
export const POST = ownerApi(async () => {
  startKeywordJob();
  return genreState();
});
