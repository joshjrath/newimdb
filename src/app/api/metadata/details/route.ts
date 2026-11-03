import { ownerApi } from "@/lib/guard";
import { fetchDetails } from "@/lib/providers";
import { mediaTypeSchema, providerSchema } from "@/lib/schemas";

export const GET = ownerApi(async (req) => {
  const p = new URL(req.url).searchParams;
  return fetchDetails(mediaTypeSchema.parse(p.get("type")), providerSchema.parse(p.get("provider")), p.get("id") ?? "");
});
