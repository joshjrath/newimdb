import { HttpError, ownerApi, readJson } from "@/lib/guard";
import { autoMergeDuplicates } from "@/lib/repo/duplicates";
import { removePlaceholderSeasons } from "@/lib/repo/episodeSync";
import { commitImdbPlan, discardPlan, imdbCommitSchema, loadPlan } from "@/lib/repo/imdbImport";

export const POST = ownerApi(async (req) => {
  const { planId, overrides, mode } = await readJson(req, imdbCommitSchema);
  const plan = loadPlan(planId);
  if (!plan) throw new HttpError(404, "That preview has expired. Upload the file again.");
  const counts = commitImdbPlan(plan, overrides, mode);
  discardPlan(planId);
  removePlaceholderSeasons();
  return { counts, mergedDuplicates: autoMergeDuplicates() };
});
