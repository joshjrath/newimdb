import { ownerApi, readJson } from "@/lib/guard";
import { createMediaSchema } from "@/lib/schemas";
import { createMedia, findByProviderIds, listMedia, type ListQuery } from "@/lib/repo/media";
import { HttpError } from "@/lib/guard";
import { MEDIA_TYPES, WATCH_STATUSES, type MediaType, type WatchStatus } from "@/lib/domain/types";

export const dynamic = "force-dynamic";

export const GET = ownerApi(async (req) => {
  const p = new URL(req.url).searchParams;
  const type = p.get("type") as MediaType | null;
  const status = p.get("status");
  const q: ListQuery = {
    type: type && MEDIA_TYPES.includes(type) ? type : undefined,
    status: status === "none" ? "none" : status && WATCH_STATUSES.includes(status as WatchStatus) ? (status as WatchStatus) : undefined,
    tag: p.get("tag") || undefined,
    q: p.get("q") || undefined,
    featured: p.get("featured") === "1" || undefined,
    sort: (["recent", "rating", "title", "year", "added"].includes(p.get("sort") ?? "") ? p.get("sort") : "recent") as ListQuery["sort"],
    page: Number(p.get("page")) || 1,
    pageSize: Number(p.get("pageSize")) || 50,
  };
  return listMedia(q);
});

export const POST = ownerApi(async (req) => {
  const input = createMediaSchema.parse(await readJson(req));
  const force = new URL(req.url).searchParams.get("allowDuplicate") === "1";
  const dup = findByProviderIds(input.type, input.metadata);
  if (dup && !force) {
    throw new HttpError(409, "This title is already in your library.", { code: "duplicate", existingId: dup });
  }
  return { media: createMedia({ ...input, review: { visibility: "private", ...input.review } }) };
});
