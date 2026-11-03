import { ownerApi, readJson } from "@/lib/guard";
import { commitLetterboxd, commitSchema } from "@/lib/repo/imports";

export const dynamic = "force-dynamic";

export const POST = ownerApi(async (req) => {
  const { items } = commitSchema.parse(await readJson(req));
  return { counts: commitLetterboxd(items) };
});
