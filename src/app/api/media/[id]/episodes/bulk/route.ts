import { idParams, ownerApi, readJson } from "@/lib/guard";
import { bulkAssessSchema } from "@/lib/schemas";
import { bulkAssess } from "@/lib/repo/media";

type Ctx = { params: Promise<{ id: string }> };

export const POST = ownerApi<Ctx>(async (req, { params }) => {
  const { id } = await idParams(params);
  const input = await readJson(req, bulkAssessSchema);
  return { segments: bulkAssess(id, input.episodeIds, input.action, input.rating) };
});
