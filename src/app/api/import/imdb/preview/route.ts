import { z } from "zod";
import { HttpError, ownerApi, readJson } from "@/lib/guard";
import { imdbKind, parseImdbRatings } from "@/lib/domain/imdb";
import { lookupEpisodes } from "@/lib/imdb/datasets";
import { buildImdbPlan, planSummary, savePlan } from "@/lib/repo/imdbImport";

const schema = z.object({ csv: z.string().min(1).max(30_000_000), lookupEpisodes: z.boolean() });

/** Preview only: reads the export, sorts it, and keeps the plan on disk. Nothing is imported yet. */
export const POST = ownerApi(async (req) => {
  const { csv, lookupEpisodes: wantLookup } = await readJson(req, schema);
  let parsed;
  try {
    parsed = parseImdbRatings(csv);
  } catch (e) {
    throw new HttpError(400, (e as Error).message);
  }
  if (!parsed.rows.length) throw new HttpError(400, "No ratings found in that file.");
  const episodeIds = new Set(parsed.rows.filter((r) => imdbKind(r.titleType) === "episode").map((r) => r.imdbId));
  const seriesIds = new Set(parsed.rows.filter((r) => imdbKind(r.titleType) === "series").map((r) => r.imdbId));
  let lookup = null;
  let lookupError: string | null = null;
  if (wantLookup && (episodeIds.size || seriesIds.size)) {
    try {
      lookup = await lookupEpisodes(episodeIds, seriesIds);
    } catch (e) {
      lookupError = (e as Error).message;
    }
  }
  const plan = buildImdbPlan(parsed.rows, parsed.invalid, lookup, lookupError);
  savePlan(plan);
  return planSummary(plan);
});
