import { idParams, ownerApi, readJson } from "@/lib/guard";
import { listItemsSchema } from "@/lib/schemas";
import { getList, reorderList } from "@/lib/repo/lists";

type Ctx = { params: Promise<{ id: string }> };

/** Save your own order (the list switches to "My order"). */
export const PUT = ownerApi<Ctx>(async (req, { params }) => {
  const { id } = await idParams(params);
  reorderList(id, (await readJson(req, listItemsSchema)).mediaIds);
  return { list: getList(id) };
});
