import { ownerApi } from "@/lib/guard";
import { getDb } from "@/lib/db";
import { allTags } from "@/lib/repo/tags";

export const GET = ownerApi(async (req) => ({ tags: allTags(getDb(), new URL(req.url).searchParams.get("type") ?? undefined) }));
