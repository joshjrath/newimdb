import { ownerApi } from "@/lib/guard";
import { searchMetadata } from "@/lib/providers";
import { mediaTypeSchema } from "@/lib/schemas";

export const GET = ownerApi(async (req) => {
  const p = new URL(req.url).searchParams;
  return searchMetadata(mediaTypeSchema.parse(p.get("type")), p.get("q") ?? "");
});
