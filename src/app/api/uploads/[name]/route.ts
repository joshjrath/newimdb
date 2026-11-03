import { HttpError, ownerApi } from "@/lib/guard";
import { readUpload } from "@/lib/files/images";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ name: string }> };

export const GET = ownerApi<Ctx>(async (_req, { params }) => {
  const img = readUpload((await params).name);
  if (!img) throw new HttpError(404, "Not found.");
  return new Response(new Uint8Array(img.data), {
    headers: { "Content-Type": img.mime, "Cache-Control": "private, max-age=86400", "X-Content-Type-Options": "nosniff" },
  });
});
