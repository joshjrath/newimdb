import { z } from "zod";
import { idParams, ownerApi, readJson } from "@/lib/guard";
import { setSharing, shareState } from "@/lib/repo/lists";

type Ctx = { params: Promise<{ id: string }> };
const body = z.object({ on: z.boolean(), ratings: z.boolean().optional() }).strict();

export const GET = ownerApi<Ctx>(async (_req, { params }) => ({ share: shareState((await idParams(params)).id) }));

/** Share this list by link (or stop: the link stops working at once). */
export const POST = ownerApi<Ctx>(async (req, { params }) => {
  const { id } = await idParams(params);
  return { share: setSharing(id, await readJson(req, body)) };
});
