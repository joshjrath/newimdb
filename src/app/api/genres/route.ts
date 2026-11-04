import { ownerApi, readJson } from "@/lib/guard";
import { genreCreateSchema } from "@/lib/schemas";
import { createGenre } from "@/lib/repo/genres";
import { startKeywordJob } from "@/lib/genres/keywords";
import { genreState } from "@/lib/genres/state";

export const GET = ownerApi(async () => genreState());

/** Add a genre filter. It tags your whole library straight away. */
export const POST = ownerApi(async (req) => {
  const { name, rules } = await readJson(req, genreCreateSchema);
  const { genre, tagged } = createGenre(name, rules);
  startKeywordJob({ quiet: true });
  return { genre, tagged, ...genreState() };
});
