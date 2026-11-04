import { getSharedList } from "@/lib/repo/lists";
import { getPoster, imageResponse } from "@/lib/files/images";

/** Posters for a shared list's page: only images that are on that list. */
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const src = new URL(req.url).searchParams.get("src") ?? "";
  const list = getSharedList(token);
  if (!list || !list.items.some((i) => i.posterUrl === src)) return new Response("Not found", { status: 404 });
  const img = await getPoster(src);
  return img ? imageResponse(img) : new Response("Not found", { status: 404 });
}
