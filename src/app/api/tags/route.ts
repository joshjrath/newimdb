import { ownerApi } from "@/lib/guard";
import { getDb } from "@/lib/db";
import { allTags } from "@/lib/repo/tags";

export const dynamic = "force-dynamic";

export const GET = ownerApi(async (req) => {
  const type = new URL(req.url).searchParams.get("type") ?? undefined;
  return { tags: allTags(getDb(), type) };
});
