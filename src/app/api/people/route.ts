import { ownerApi, readJson } from "@/lib/guard";
import { personNameSchema } from "@/lib/schemas";
import { createPerson, listPeople } from "@/lib/repo/people";

export const GET = ownerApi(async () => ({ people: listPeople() }));

export const POST = ownerApi(async (req) => {
  const { name } = await readJson(req, personNameSchema);
  return { person: createPerson(name), people: listPeople() };
});
