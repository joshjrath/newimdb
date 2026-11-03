import { intParam, ownerApi, readJson } from "@/lib/guard";
import { assessmentSchema } from "@/lib/schemas";
import { setAssessment } from "@/lib/repo/media";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string; episodeId: string }> };

export const PATCH = ownerApi<Ctx>(async (req, { params }) => {
  const p = await params;
  const patch = assessmentSchema.parse(await readJson(req));
  return { segments: setAssessment(intParam(p.id), intParam(p.episodeId), patch) };
});
