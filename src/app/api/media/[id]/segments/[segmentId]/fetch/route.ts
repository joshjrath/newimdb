import { z } from "zod";
import { HttpError, idParams, ownerApi, readJson } from "@/lib/guard";
import { importSegmentEpisodes, requireMedia, segmentProvider } from "@/lib/repo/media";
import { fetchSegmentEpisodes } from "@/lib/providers";
import { providerSchema } from "@/lib/schemas";

type Ctx = { params: Promise<{ id: string; segmentId: string }> };

/** Pull episode titles for one segment. Adds missing episodes, never deletes, never touches ratings. */
export const POST = ownerApi<Ctx>(async (req, { params }) => {
  const { id, segmentId } = await idParams(params);
  const m = requireMedia(id);
  const stored = segmentProvider(id, segmentId);
  const body = await readJson(req, z.object({ provider: providerSchema.optional(), providerRef: z.string().max(60).optional() }));
  const provider = body.provider ?? stored.provider;
  const ref = body.providerRef ?? stored.providerRef;
  if (!provider || !ref) throw new HttpError(400, "Set a provider and reference for this segment first (e.g. TMDB 1399:2 or MAL 5114).");
  const episodes = await fetchSegmentEpisodes(m.type, provider, ref);
  return importSegmentEpisodes(id, segmentId, provider, ref, episodes);
});
