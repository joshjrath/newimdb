import { z } from "zod";
import { ownerApi, readJson } from "@/lib/guard";
import { backupSchema, restoreBackup, summarizeBackup } from "@/lib/repo/backup";

export const dynamic = "force-dynamic";

export const POST = ownerApi(async (req) => {
  const body = z
    .object({ backup: backupSchema, mode: z.enum(["merge", "replace"]), dryRun: z.boolean().optional() })
    .parse(await readJson(req));
  if (body.dryRun) return { summary: summarizeBackup(body.backup) };
  return { result: await restoreBackup(body.backup, body.mode) };
});
