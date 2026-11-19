import { z } from "zod";
import { ownerApi, readJson } from "@/lib/guard";
import { mediaTypeSchema } from "@/lib/schemas";
import { getRankings, setTierList, setTopList } from "@/lib/repo/rankings";

const ids = z.array(z.number().int().positive()).max(5000);
const body = z.union([
  z.object({ kind: mediaTypeSchema, top: ids }).strict(),
  z.object({ kind: mediaTypeSchema, tiers: z.object({ S: ids, A: ids, B: ids, C: ids, F: ids }).partial() }).strict(),
]);

export const GET = ownerApi(async (req) => ({ rankings: getRankings(mediaTypeSchema.parse(new URL(req.url).searchParams.get("kind") ?? "movie")) }));

/** Save your top list or tier list for one kind (the whole order at once). */
export const PUT = ownerApi(async (req) => {
  const b = await readJson(req, body);
  if ("top" in b) setTopList(b.kind, b.top);
  else setTierList(b.kind, b.tiers);
  return { rankings: getRankings(b.kind) };
});
