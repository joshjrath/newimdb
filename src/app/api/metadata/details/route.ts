import { HttpError, ownerApi } from "@/lib/guard";
import { fetchDetails, type ProviderName } from "@/lib/providers";
import { MEDIA_TYPES, type MediaType } from "@/lib/domain/types";

export const dynamic = "force-dynamic";

export const GET = ownerApi(async (req) => {
  const p = new URL(req.url).searchParams;
  const type = p.get("type") as MediaType;
  const provider = p.get("provider") as ProviderName;
  if (!MEDIA_TYPES.includes(type)) throw new HttpError(400, "Unknown type.");
  if (!["tmdb", "tvmaze", "jikan", "anilist"].includes(provider)) throw new HttpError(400, "Unknown provider.");
  return fetchDetails(type, provider, p.get("id") ?? "");
});
