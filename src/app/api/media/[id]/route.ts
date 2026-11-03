import { HttpError, intParam, ownerApi, readJson } from "@/lib/guard";
import { mediaPatchSchema } from "@/lib/schemas";
import { deleteMedia, getMediaDetail, updateMedia } from "@/lib/repo/media";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export const GET = ownerApi<Ctx>(async (_req, { params }) => {
  const m = getMediaDetail(intParam((await params).id));
  if (!m) throw new HttpError(404, "Not found.");
  return { media: m };
});

export const PATCH = ownerApi<Ctx>(async (req, { params }) => {
  const id = intParam((await params).id);
  const patch = mediaPatchSchema.parse(await readJson(req));
  return { media: updateMedia(id, patch) };
});

export const DELETE = ownerApi<Ctx>(async (_req, { params }) => {
  const n = deleteMedia([intParam((await params).id)]);
  if (!n) throw new HttpError(404, "Not found.");
  return { deleted: n };
});
