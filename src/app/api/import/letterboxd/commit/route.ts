import { ownerApi, readJson } from "@/lib/guard";
import { autoMergeDuplicates } from "@/lib/repo/duplicates";
import { commitLetterboxd, commitSchema } from "@/lib/repo/imports";

export const POST = ownerApi(async (req) => {
  const counts = commitLetterboxd((await readJson(req, commitSchema)).items);
  return { counts, mergedDuplicates: autoMergeDuplicates() };
});
