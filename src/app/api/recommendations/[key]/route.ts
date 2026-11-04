import { z } from "zod";
import { HttpError, ownerApi, readJson } from "@/lib/guard";
import { dismissRecommendation, getRecommendation, removeRecommendation } from "@/lib/recommend/job";
import { createMedia } from "@/lib/repo/media";
import { tmdbMovie, tmdbTv } from "@/lib/providers/tmdb";
import { anilistDetails } from "@/lib/providers/anime";
import { mediaHref } from "@/lib/domain/links";
import type { ProviderDetails } from "@/lib/providers/types";

type Ctx = { params: Promise<{ key: string }> };
const body = z.object({ action: z.enum(["add", "dismiss"]) }).strict();

/** "add": put it in your library as Plan to watch (with its seasons). "dismiss": never suggest it again. */
export const POST = ownerApi<Ctx>(async (req, { params }) => {
  const key = decodeURIComponent((await params).key);
  const { action } = await readJson(req, body);
  const rec = getRecommendation(key);
  if (!rec) throw new HttpError(404, "That recommendation has already gone.");
  if (action === "dismiss") {
    dismissRecommendation(key);
    return { ok: true };
  }
  let details: ProviderDetails | null = null;
  try {
    if (rec.tmdb) details = rec.tmdb.kind === "movie" ? await tmdbMovie(String(rec.tmdb.id)) : await tmdbTv(String(rec.tmdb.id));
    else if (rec.anilistId) details = await anilistDetails(String(rec.anilistId));
  } catch {
    details = null; // fall back to what we already know
  }
  const media = createMedia(
    {
      type: rec.type,
      metadata: details?.metadata ?? {
        title: rec.title,
        originalTitle: rec.originalTitle,
        year: rec.year,
        overview: rec.overview,
        posterUrl: rec.posterUrl,
        backdropUrl: rec.backdropUrl,
        genres: rec.genres,
        tmdbId: rec.tmdb?.id ?? null,
        anilistId: rec.anilistId,
        malId: rec.malId,
      },
      review: { status: "plan", visibility: "private" },
      segments: rec.type === "movie" ? [] : (details?.segments ?? []),
    },
    { source: "manual" },
  );
  removeRecommendation(key);
  return { media: { id: media.id, href: mediaHref(media) } };
});
