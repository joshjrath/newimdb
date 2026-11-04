import { HttpError, idParams, ownerApi, readJson } from "@/lib/guard";
import { listPatchSchema } from "@/lib/schemas";
import { deleteList, getList, updateList } from "@/lib/repo/lists";

type Ctx = { params: Promise<{ id: string }> };

export const GET = ownerApi<Ctx>(async (_req, { params }) => {
  const list = getList((await idParams(params)).id);
  if (!list) throw new HttpError(404, "That list no longer exists.");
  return { list };
});

export const PATCH = ownerApi<Ctx>(async (req, { params }) => {
  const { id } = await idParams(params);
  updateList(id, await readJson(req, listPatchSchema));
  return { list: getList(id) };
});

export const DELETE = ownerApi<Ctx>(async (_req, { params }) => {
  deleteList((await idParams(params)).id);
  return { ok: true };
});
