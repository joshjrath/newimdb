import { ownerApi, readJson } from "@/lib/guard";
import { bulkMediaSchema } from "@/lib/schemas";
import { bulkUpdate } from "@/lib/repo/media";

export const dynamic = "force-dynamic";

export const POST = ownerApi(async (req) => {
  const input = bulkMediaSchema.parse(await readJson(req));
  return { changed: bulkUpdate(input.ids, input.action, { status: input.status, tag: input.tag }) };
});
