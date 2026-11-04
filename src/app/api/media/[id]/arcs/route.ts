import { z } from "zod";
import { idParams, ownerApi, readJson } from "@/lib/guard";
import { requireMedia } from "@/lib/repo/media";
import { addArc, deleteArc, listArcs } from "@/lib/repo/arcs";

type Ctx = { params: Promise<{ id: string }> };
const add = z.object({ name: z.string().trim().min(1).max(80), firstEp: z.number().int().min(1).max(20000), lastEp: z.number().int().min(1).max(20000) }).strict();
const del = z.object({ arcId: z.number().int().positive() }).strict();

export const GET = ownerApi<Ctx>(async (_req, { params }) => ({ arcs: listArcs((await idParams(params)).id) }));

export const POST = ownerApi<Ctx>(async (req, { params }) => {
  const { id } = await idParams(params);
  requireMedia(id);
  return { arcs: addArc(id, await readJson(req, add)) };
});

export const DELETE = ownerApi<Ctx>(async (req, { params }) => {
  const { id } = await idParams(params);
  return { arcs: deleteArc(id, (await readJson(req, del)).arcId) };
});
