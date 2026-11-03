import { HttpError, ownerApi } from "@/lib/guard";
import { saveUpload } from "@/lib/files/images";

export const dynamic = "force-dynamic";

export const POST = ownerApi(async (req) => {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!file || typeof file === "string") throw new HttpError(400, "Attach an image file.");
  try {
    const name = saveUpload(Buffer.from(await file.arrayBuffer()));
    return { url: `/api/uploads/${name}` };
  } catch (e) {
    throw new HttpError(400, (e as Error).message);
  }
});
