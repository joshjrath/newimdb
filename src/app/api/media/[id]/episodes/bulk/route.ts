import { intParam, ownerApi, readJson } from "@/lib/guard";
import { bulkAssessSchema } from "@/lib/schemas";
import { bulkAssess } from "@/lib/repo/media";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export const POST = ownerApi<Ctx>(async (req, { params }) => {
  const input = bulkAssessSchema.parse(await readJson(req));
  return { segments: bulkAssess(intParam((await params).id), input.episodeIds, input.action, input.rating) };
});
