import { ownerApi } from "@/lib/guard";
import { markReleasesSeen, updatesSummary } from "@/lib/repo/releases";

export const POST = ownerApi(async () => {
  markReleasesSeen();
  return updatesSummary();
});
