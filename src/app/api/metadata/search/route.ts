import { HttpError, ownerApi } from "@/lib/guard";
import { searchMetadata } from "@/lib/providers";
import { MEDIA_TYPES, type MediaType } from "@/lib/domain/types";

export const dynamic = "force-dynamic";

export const GET = ownerApi(async (req) => {
  const p = new URL(req.url).searchParams;
  const type = p.get("type") as MediaType;
  if (!MEDIA_TYPES.includes(type)) throw new HttpError(400, "Pick Movies, TV Shows or Anime.");
  return searchMetadata(type, p.get("q") ?? "");
});
