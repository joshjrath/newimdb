import { idParams, ownerApi, readJson } from "@/lib/guard";
import { structureSchema } from "@/lib/schemas";
import { saveStructure } from "@/lib/repo/media";

type Ctx = { params: Promise<{ id: string }> };

export const PUT = ownerApi<Ctx>(async (req, { params }) => {
  const { id } = await idParams(params);
  return saveStructure(id, await readJson(req, structureSchema));
});
