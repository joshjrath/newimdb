import { z } from "zod";
import { idParams, ownerApi, readJson } from "@/lib/guard";
import { deleteBoard, getBoard, setBoardTiers, setBoardTop, updateBoard } from "@/lib/repo/boards";

type Ctx = { params: Promise<{ id: string }> };
const ids = z.array(z.number().int().positive()).max(5000);
const put = z.union([z.object({ top: ids }).strict(), z.object({ tiers: z.object({ S: ids, A: ids, B: ids, C: ids, F: ids }).partial() }).strict()]);
const patch = z.object({ name: z.string().trim().min(1).max(80).optional(), mode: z.enum(["top", "tiers"]).optional() }).strict();

export const GET = ownerApi<Ctx>(async (_req, { params }) => ({ board: getBoard((await idParams(params)).id) }));

/** Save the top list or the tier list (the whole order at once). */
export const PUT = ownerApi<Ctx>(async (req, { params }) => {
  const { id } = await idParams(params);
  const b = await readJson(req, put);
  if ("top" in b) setBoardTop(id, b.top);
  else setBoardTiers(id, b.tiers);
  return { board: getBoard(id) };
});

export const PATCH = ownerApi<Ctx>(async (req, { params }) => {
  const { id } = await idParams(params);
  updateBoard(id, await readJson(req, patch));
  return { board: getBoard(id) };
});

export const DELETE = ownerApi<Ctx>(async (_req, { params }) => {
  deleteBoard((await idParams(params)).id);
  return { ok: true };
});
