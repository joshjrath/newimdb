import { z } from "zod";
import { idParams, ownerApi, readJson } from "@/lib/guard";
import { getDb } from "@/lib/db";
import { requireMedia } from "@/lib/repo/media";
import { checkFillerFor, readNote } from "@/lib/anime/filler";
import { slugFrom } from "@/lib/providers/animefiller";

type Ctx = { params: Promise<{ id: string }> };
const body = z.object({ page: z.string().trim().max(300).optional() }).strict();

/** Where this anime's filler came from (or why it didn't). */
export const GET = ownerApi<Ctx>(async (_req, { params }) => ({ note: readNote(getDb(), (await idParams(params)).id) }));

/** Check animefillerlist.com for this anime now; `page` (a link or name) picks the page to use. */
export const POST = ownerApi<Ctx>(async (req, { params }) => {
  const { id } = await idParams(params);
  requireMedia(id);
  const { page } = await readJson(req, body);
  const slug = page ? (slugFrom(page) ?? undefined) : undefined;
  return checkFillerFor(id, { slug });
});
