import { ownerApi } from "@/lib/guard";
import { updatesSummary } from "@/lib/repo/releases";

export const GET = ownerApi(async () => updatesSummary());
