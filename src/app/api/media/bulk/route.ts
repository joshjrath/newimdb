import { ownerApi, readJson } from "@/lib/guard";
import { bulkMediaSchema } from "@/lib/schemas";
import { bulkUpdate } from "@/lib/repo/media";

export const POST = ownerApi(async (req) => {
  const { ids, action, status, tag, personId } = await readJson(req, bulkMediaSchema);
  return { changed: bulkUpdate(ids, action, { status, tag, personId }) };
});
