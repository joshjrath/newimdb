import { HttpError, ownerApi } from "@/lib/guard";
import { getPoster, imageResponse, isAllowedPosterUrl } from "@/lib/files/images";

/** Authenticated, allowlisted image proxy. Keeps the page CSP at img-src 'self' and lets canvas export read pixels. */
export const GET = ownerApi(async (req) => {
  const src = new URL(req.url).searchParams.get("src") ?? "";
  if (!isAllowedPosterUrl(src)) throw new HttpError(400, "Image host not allowed.");
  const img = await getPoster(src);
  if (!img) throw new HttpError(404, "Image unavailable.");
  return imageResponse(img);
});
