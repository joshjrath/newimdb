import { z } from "zod";
import { ownerApi, readJson } from "@/lib/guard";
import { runEpisodeSync, syncOneShow, syncState } from "@/lib/episodes/sync";

/** Status of the automatic new-episode check. */
export const GET = ownerApi(async () => ({ sync: syncState() }));

const body = z.object({ mediaId: z.number().int().positive().optional() }).strict();

/** Check every show now, in the background; or one show (`mediaId`) right away. */
export const POST = ownerApi(async (req) => {
  const { mediaId } = await readJson(req, body);
  if (mediaId) return { one: await syncOneShow(mediaId) };
  void runEpisodeSync({ all: true }).catch(() => {});
  await new Promise((r) => setTimeout(r, 50));
  return { sync: syncState() };
});
