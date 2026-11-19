import { ownerApi, readJson } from "@/lib/guard";
import { listCreateSchema } from "@/lib/schemas";
import { z } from "zod";
import { createList, listLists, reorderLists } from "@/lib/repo/lists";

export const GET = ownerApi(async () => ({ lists: listLists() }));

export const POST = ownerApi(async (req) => {
  const id = createList(await readJson(req, listCreateSchema));
  return { id, lists: listLists() };
});

/** Reorder your lists: the ids in the order you want them. */
export const PUT = ownerApi(async (req) => {
  reorderLists((await readJson(req, z.object({ order: z.array(z.number().int().positive()).max(1000) }).strict())).order);
  return { lists: listLists() };
});
