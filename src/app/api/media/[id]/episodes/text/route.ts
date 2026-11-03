import { z } from "zod";
import { HttpError, intParam, ownerApi, readJson } from "@/lib/guard";
import { applyTextAssignments, getSegments, getMedia } from "@/lib/repo/media";
import { exportEpisodeText, parseEpisodeText, resolveAssignments } from "@/lib/domain/episodeText";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export const GET = ownerApi<Ctx>(async (req, { params }) => {
  const id = intParam((await params).id);
  if (!getMedia(id)) throw new HttpError(404, "Not found.");
  const all = new URL(req.url).searchParams.get("all") === "1";
  return { text: exportEpisodeText(getSegments(id), { includeUnwatched: all }) };
});

/** Atomic: if any line has a problem, nothing is applied. */
export const POST = ownerApi<Ctx>(async (req, { params }) => {
  const id = intParam((await params).id);
  const { text, dryRun } = z.object({ text: z.string().max(500000), dryRun: z.boolean().optional() }).parse(await readJson(req));
  const segments = getSegments(id);
  const { resolved, errors } = resolveAssignments(segments, parseEpisodeText(text));
  if (errors.length) throw new HttpError(400, `${errors.length} line(s) need fixing. Nothing was applied.`, { lineErrors: errors });
  if (dryRun) return { count: resolved.length, dryRun: true };
  return { count: resolved.length, segments: applyTextAssignments(id, resolved) };
});
