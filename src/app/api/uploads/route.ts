import { HttpError, ownerApi } from "@/lib/guard";
import { saveUpload } from "@/lib/files/images";

export const POST = ownerApi(async (req) => {
  const file = (await req.formData().catch(() => null))?.get("file");
  if (!file || typeof file === "string") throw new HttpError(400, "Attach an image file.");
  try {
    return { url: `/api/uploads/${await saveUpload(Buffer.from(await file.arrayBuffer()))}` };
  } catch (e) {
    throw new HttpError(400, (e as Error).message);
  }
});
