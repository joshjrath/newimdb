import { HttpError, idParams, ownerApi, readJson } from "@/lib/guard";
import { mediaPatchSchema } from "@/lib/schemas";
import { deleteMedia, getMediaDetail, requireMedia, updateMedia } from "@/lib/repo/media";

type Ctx = { params: Promise<{ id: string }> };

export const GET = ownerApi<Ctx>(async (_req, { params }) => {
  const { id } = await idParams(params);
  requireMedia(id);
  return { media: getMediaDetail(id) };
});

export const PATCH = ownerApi<Ctx>(async (req, { params }) => {
  const { id } = await idParams(params);
  return { media: updateMedia(id, await readJson(req, mediaPatchSchema)) };
});

export const DELETE = ownerApi<Ctx>(async (_req, { params }) => {
  const { id } = await idParams(params);
  if (!deleteMedia([id])) throw new HttpError(404, "Not found.");
  return { deleted: 1 };
});
