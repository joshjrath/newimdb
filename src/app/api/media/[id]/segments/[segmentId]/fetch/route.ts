import { z } from "zod";
import { HttpError, intParam, ownerApi, readJson } from "@/lib/guard";
import { getDb } from "@/lib/db";
import { applyProviderEpisodes, getMedia, getSegments } from "@/lib/repo/media";
import { fetchSegmentEpisodes } from "@/lib/providers";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string; segmentId: string }> };

/** Pull episode titles for one segment. Adds missing episodes, never deletes, never touches ratings. */
export const POST = ownerApi<Ctx>(async (req, { params }) => {
  const p = await params;
  const id = intParam(p.id);
  const segmentId = intParam(p.segmentId);
  const m = getMedia(id);
  if (!m) throw new HttpError(404, "Not found.");
  const seg = getDb().prepare(`SELECT * FROM segment WHERE id = ? AND media_id = ?`).get(segmentId, id) as
    | { provider: string | null; provider_ref: string | null }
    | undefined;
  if (!seg) throw new HttpError(404, "Segment not found.");
  const body = z
    .object({ provider: z.enum(["tmdb", "tvmaze", "jikan"]).optional(), providerRef: z.string().max(60).optional() })
    .parse(await readJson(req));
  const provider = body.provider ?? seg.provider;
  const ref = body.providerRef ?? seg.provider_ref;
  if (!provider || !ref) throw new HttpError(400, "Set a provider and reference for this segment first (e.g. TMDB 1399:2 or MAL 5114).");
  const episodes = await fetchSegmentEpisodes(m.type, provider, ref);
  const db = getDb();
  db.prepare(`UPDATE segment SET provider = ?, provider_ref = ? WHERE id = ?`).run(provider, ref, segmentId);
  const result = applyProviderEpisodes(segmentId, episodes, { grow: true });
  return { ...result, segments: getSegments(id) };
});
