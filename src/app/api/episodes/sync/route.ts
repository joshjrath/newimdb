import { ownerApi } from "@/lib/guard";
import { runEpisodeSync, syncState } from "@/lib/episodes/sync";

/** Status of the automatic new-episode check. */
export const GET = ownerApi(async () => ({ sync: syncState() }));

/** Check every show now, in the background. */
export const POST = ownerApi(async () => {
  void runEpisodeSync({ all: true }).catch(() => {});
  await new Promise((r) => setTimeout(r, 50));
  return { sync: syncState() };
});
