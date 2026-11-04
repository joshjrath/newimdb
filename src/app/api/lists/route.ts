import { ownerApi, readJson } from "@/lib/guard";
import { listCreateSchema } from "@/lib/schemas";
import { createList, listLists } from "@/lib/repo/lists";

export const GET = ownerApi(async () => ({ lists: listLists() }));

export const POST = ownerApi(async (req) => {
  const id = createList(await readJson(req, listCreateSchema));
  return { id, lists: listLists() };
});
