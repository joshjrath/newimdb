import { HttpError, ownerApi } from "@/lib/guard";
import { imageResponse, readUpload } from "@/lib/files/images";

type Ctx = { params: Promise<{ name: string }> };

export const GET = ownerApi<Ctx>(async (_req, { params }) => {
  const img = await readUpload((await params).name);
  if (!img) throw new HttpError(404, "Not found.");
  return imageResponse(img);
});
