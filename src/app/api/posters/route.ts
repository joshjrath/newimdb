import { ownerApi } from "@/lib/guard";
import { currentPosterJob, startPosterJob } from "@/lib/posters/job";
import { missingPosterIds } from "@/lib/repo/media";
import { tmdbConfigured } from "@/lib/providers/tmdb";

const status = () => ({ job: currentPosterJob(), missing: missingPosterIds().length, tmdb: tmdbConfigured() });

/** How many titles still need a poster, and the fetch's progress. */
export const GET = ownerApi(async () => status());

/** Start fetching missing posters in the background (or return the one already running). */
export const POST = ownerApi(async () => {
  startPosterJob();
  return status();
});
