import { HttpError, idParams, ownerApi } from "@/lib/guard";
import { applyMetadataRefresh, requireMedia } from "@/lib/repo/media";
import { availableProviders, fetchDetails } from "@/lib/providers";
import { PROVIDER_ID_FIELD } from "@/lib/domain/types";

type Ctx = { params: Promise<{ id: string }> };

/** Re-pull third-party metadata (no episode lists). Locked fields, reviews, ratings and structure are never touched. */
export const POST = ownerApi<Ctx>(async (_req, { params }) => {
  const { id } = await idParams(params);
  const m = requireMedia(id);
  const provider = availableProviders(m.type).find((p) => m[PROVIDER_ID_FIELD[p]] != null);
  if (!provider) throw new HttpError(400, "Add a provider ID (TMDB, TVmaze, MAL or AniList) in Details first.");
  const details = await fetchDetails(m.type, provider, String(m[PROVIDER_ID_FIELD[provider]]), { episodes: false });
  return { media: applyMetadataRefresh(id, details.metadata), provider, warnings: details.warnings };
});
