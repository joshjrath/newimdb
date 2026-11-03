import { z } from "zod";
import { HttpError, idParams, ownerApi, readJson } from "@/lib/guard";
import { applyTextAssignments, getSegments, requireMedia } from "@/lib/repo/media";
import { exportEpisodeText, parseEpisodeText, resolveAssignments } from "@/lib/domain/episodeText";

type Ctx = { params: Promise<{ id: string }> };

export const GET = ownerApi<Ctx>(async (req, { params }) => {
  const { id } = await idParams(params);
  requireMedia(id);
  const all = new URL(req.url).searchParams.get("all") === "1";
  return { text: exportEpisodeText(getSegments(id), { includeUnwatched: all }) };
});

/** Atomic: if any line has a problem, nothing is applied. */
export const POST = ownerApi<Ctx>(async (req, { params }) => {
  const { id } = await idParams(params);
  requireMedia(id);
  const { text, dryRun } = await readJson(req, z.object({ text: z.string().max(500000), dryRun: z.boolean().optional() }));
  const { resolved, errors } = resolveAssignments(getSegments(id), parseEpisodeText(text));
  if (errors.length) throw new HttpError(400, `${errors.length} line(s) need fixing. Nothing was applied.`, { lineErrors: errors });
  if (dryRun) return { count: resolved.length, dryRun: true };
  return { count: resolved.length, segments: applyTextAssignments(id, resolved) };
});
