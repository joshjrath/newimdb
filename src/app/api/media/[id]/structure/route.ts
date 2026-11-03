import { intParam, ownerApi, readJson } from "@/lib/guard";
import { structureSchema } from "@/lib/schemas";
import { getMedia, saveStructure } from "@/lib/repo/media";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export const PUT = ownerApi<Ctx>(async (req, { params }) => {
  const id = intParam((await params).id);
  const input = structureSchema.parse(await readJson(req));
  const segments = saveStructure(id, input);
  return { segments, version: getMedia(id)!.version };
});
