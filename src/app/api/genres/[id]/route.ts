import { idParams, ownerApi, readJson } from "@/lib/guard";
import { genrePatchSchema } from "@/lib/schemas";
import { deleteGenre, updateGenre } from "@/lib/repo/genres";
import { startKeywordJob } from "@/lib/genres/keywords";
import { genreState } from "@/lib/genres/state";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = ownerApi<Ctx>(async (req, { params }) => {
  const { id } = await idParams(params);
  const { tagged } = updateGenre(id, await readJson(req, genrePatchSchema));
  startKeywordJob({ quiet: true });
  return { tagged, ...genreState() };
});

/** Removes the filter. Titles keep their own genres; only this filter goes. */
export const DELETE = ownerApi<Ctx>(async (_req, { params }) => {
  const { id } = await idParams(params);
  deleteGenre(id);
  return genreState();
});
