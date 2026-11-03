import { HttpError, ownerApi } from "@/lib/guard";
import { getPoster, isAllowedPosterUrl } from "@/lib/files/images";

export const dynamic = "force-dynamic";

/** Authenticated, allowlisted image proxy. Keeps the page CSP at img-src 'self' and lets canvas export read pixels. */
export const GET = ownerApi(async (req) => {
  const src = new URL(req.url).searchParams.get("src") ?? "";
  if (!isAllowedPosterUrl(src)) throw new HttpError(400, "Image host not allowed.");
  const img = await getPoster(src);
  if (!img) throw new HttpError(404, "Image unavailable.");
  return new Response(new Uint8Array(img.data), {
    headers: { "Content-Type": img.mime, "Cache-Control": "private, max-age=86400", "X-Content-Type-Options": "nosniff" },
  });
});
