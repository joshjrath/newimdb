import { HttpError, ownerApi, readJson } from "@/lib/guard";
import { parseListQuery } from "@/lib/listQuery";
import { createMediaSchema } from "@/lib/schemas";
import { createMedia, findByProviderIds, listMedia } from "@/lib/repo/media";

export const GET = ownerApi(async (req) => listMedia(parseListQuery(new URL(req.url).searchParams, { pageSize: 50 })));

export const POST = ownerApi(async (req) => {
  const input = await readJson(req, createMediaSchema);
  const dup = findByProviderIds(input.type, input.metadata);
  if (dup && new URL(req.url).searchParams.get("allowDuplicate") !== "1") {
    throw new HttpError(409, "This title is already in your library.", { code: "duplicate", existingId: dup });
  }
  return { media: createMedia(input) };
});
