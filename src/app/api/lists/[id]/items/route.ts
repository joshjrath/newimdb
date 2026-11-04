import { idParams, ownerApi, readJson } from "@/lib/guard";
import { listItemsSchema } from "@/lib/schemas";
import { addToList, getList, removeFromList } from "@/lib/repo/lists";

type Ctx = { params: Promise<{ id: string }> };

export const POST = ownerApi<Ctx>(async (req, { params }) => {
  const { id } = await idParams(params);
  const added = addToList(id, (await readJson(req, listItemsSchema)).mediaIds);
  return { added, list: getList(id) };
});

export const DELETE = ownerApi<Ctx>(async (req, { params }) => {
  const { id } = await idParams(params);
  const removed = removeFromList(id, (await readJson(req, listItemsSchema)).mediaIds);
  return { removed, list: getList(id) };
});
