import { idParams, ownerApi, readJson } from "@/lib/guard";
import { personNameSchema } from "@/lib/schemas";
import { deletePerson, listPeople, renamePerson } from "@/lib/repo/people";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = ownerApi<Ctx>(async (req, { params }) => {
  const { id } = await idParams(params);
  const { name } = await readJson(req, personNameSchema);
  return { person: renamePerson(id, name), people: listPeople() };
});

/** Removes the person from your list and from every title. The titles stay. */
export const DELETE = ownerApi<Ctx>(async (_req, { params }) => {
  const { id } = await idParams(params);
  return { removedFrom: deletePerson(id), people: listPeople() };
});
