import { idParams, ownerApi, readJson } from "@/lib/guard";
import { assessmentSchema } from "@/lib/schemas";
import { setAssessment } from "@/lib/repo/media";

type Ctx = { params: Promise<{ id: string; episodeId: string }> };

/** Returns only the updated episode; the client already holds the rest of the show. */
export const PATCH = ownerApi<Ctx>(async (req, { params }) => {
  const { id, episodeId } = await idParams(params);
  return { episode: setAssessment(id, episodeId, await readJson(req, assessmentSchema)) };
});
