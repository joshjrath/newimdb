import { z } from "zod";
import { HttpError, intParam, ownerApi, readJson } from "@/lib/guard";
import { applyMetadataRefresh, getMedia } from "@/lib/repo/media";
import { fetchDetails } from "@/lib/providers";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

/** Re-pull third-party metadata. Locked fields, reviews, ratings and structure are never touched. */
export const POST = ownerApi<Ctx>(async (req, { params }) => {
  const id = intParam((await params).id);
  const m = getMedia(id);
  if (!m) throw new HttpError(404, "Not found.");
  const body = z.object({ provider: z.enum(["tmdb", "tvmaze", "jikan", "anilist"]).optional() }).parse(await readJson(req));
  const candidates: [ "tmdb" | "tvmaze" | "jikan" | "anilist", number | null][] =
    m.type === "anime" ? [["jikan", m.malId], ["anilist", m.anilistId]] : m.type === "tv" ? [["tmdb", m.tmdbId], ["tvmaze", m.tvmazeId]] : [["tmdb", m.tmdbId]];
  const pick = candidates.find(([p, v]) => v != null && (!body.provider || body.provider === p));
  if (!pick) throw new HttpError(400, "Add a provider ID (TMDB, TVmaze, MAL or AniList) in Metadata first.");
  const details = await fetchDetails(m.type, pick[0], String(pick[1]));
  return { media: applyMetadataRefresh(id, details.metadata), provider: pick[0], warnings: details.warnings };
});
