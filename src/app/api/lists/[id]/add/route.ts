import { z } from "zod";
import { idParams, ownerApi, readJson } from "@/lib/guard";
import { mediaTypeSchema, providerSchema } from "@/lib/schemas";
import { addToList, getList } from "@/lib/repo/lists";
import { createMedia, findByProviderIds, titleMatcher } from "@/lib/repo/media";
import { fetchDetails } from "@/lib/providers";
import { PROVIDER_ID_FIELD } from "@/lib/domain/types";

type Ctx = { params: Promise<{ id: string }> };
const body = z.object({ type: mediaTypeSchema, provider: providerSchema, providerId: z.string().min(1).max(40), title: z.string().max(300), year: z.number().int().nullable().optional() }).strict();

/**
 * Add any title to a list, even one you haven't added or seen: if it isn't in your library
 * yet, it's added as Plan to watch (with its poster and seasons), then put on the list.
 */
export const POST = ownerApi<Ctx>(async (req, { params }) => {
  const { id } = await idParams(params);
  const b = await readJson(req, body);
  const field = PROVIDER_ID_FIELD[b.provider];
  const idValue = field === "tmdbId" || field === "tvmazeId" || field === "malId" || field === "anilistId" ? Number(b.providerId) : b.providerId;
  let mediaId =
    findByProviderIds(b.type, { [field]: idValue }) ??
    titleMatcher(b.type)(b.title, b.year ?? null);
  let created = false;
  if (!mediaId) {
    const d = await fetchDetails(b.type, b.provider, b.providerId);
    mediaId = createMedia({ type: b.type, metadata: d.metadata, review: { status: "plan", visibility: "private" }, segments: b.type === "movie" ? [] : d.segments }, { source: "manual" }).id;
    created = true;
  }
  addToList(id, [mediaId]);
  return { created, mediaId, list: getList(id) };
});
